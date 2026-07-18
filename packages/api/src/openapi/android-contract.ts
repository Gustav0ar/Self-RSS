const HTTP_METHODS = new Set(['get', 'post', 'patch', 'delete', 'put']);

type Schema = {
	$ref?: string;
	allOf?: Schema[];
	type?: string | string[];
	items?: Schema;
	required?: string[];
	properties?: Record<string, Schema>;
};

type OpenApiDocument = {
	paths?: Record<string, Record<string, unknown>>;
	components?: { schemas?: Record<string, Schema> };
};

export interface AndroidContractOptions {
	coveredOutsideRetrofit?: ReadonlySet<string>;
	intentionallyUnsupported?: ReadonlySet<string>;
	schemaMappings?: Readonly<Record<string, string>>;
	responseMappings?: Readonly<Record<string, string>>;
}

interface KotlinField {
	name: string;
	type: string;
	hasDefault: boolean;
}

export function operationKey(method: string, path: string) {
	const normalizedPath = `/${path.replace(/^\/+/, '')}`.replace(/{[^}]+}/g, '{param}');
	return `${method.toUpperCase()} ${normalizedPath}`;
}

export function extractRetrofitOperations(source: string) {
	return new Set(extractRetrofitResponses(source).keys());
}

interface RetrofitResponse {
	returnType: string;
	modelName: string | null;
	isCollection: boolean;
}

function extractRetrofitResponses(source: string) {
	const responses = new Map<string, RetrofitResponse>();
	const operation =
		/@(GET|POST|PATCH|DELETE|PUT)\("([^"]+)"\)[\s\S]*?suspend\s+fun\s+\w+\s*\([\s\S]*?\)\s*:\s*([^\n]+)/g;
	for (const match of source.matchAll(operation)) {
		const returnType = match[3]!.trim();
		const envelope = /^ApiEnvelope<(.+)>$/.exec(returnType);
		const listResponse = /^ApiListResponse<(.+)>$/.exec(returnType);
		const payload = envelope?.[1]?.trim() ?? listResponse?.[1]?.trim() ?? null;
		const listPayload = payload ? /^List<(.+)>$/.exec(payload) : null;
		responses.set(operationKey(match[1]!, match[2]!), {
			returnType,
			modelName: listPayload?.[1]?.trim() ?? payload,
			isCollection: listResponse != null || listPayload != null,
		});
	}
	return responses;
}

function extractOpenApiOperations(document: OpenApiDocument) {
	const operations = new Set<string>();
	for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
		for (const method of Object.keys(pathItem)) {
			if (HTTP_METHODS.has(method.toLowerCase())) operations.add(operationKey(method, path));
		}
	}
	return operations;
}

function extractDataClassFields(source: string, className: string): KotlinField[] | null {
	const startPattern = new RegExp(`data\\s+class\\s+${className}\\s*\\(`);
	const startMatch = startPattern.exec(source);
	if (!startMatch) return null;
	const bodyStart = startMatch.index + startMatch[0].length;
	let depth = 1;
	let cursor = bodyStart;
	for (; cursor < source.length && depth > 0; cursor++) {
		if (source[cursor] === '(') depth++;
		else if (source[cursor] === ')') depth--;
	}
	const body = source.slice(bodyStart, cursor - 1);
	const fields: KotlinField[] = [];
	const fieldPattern = /\bval\s+(\w+)\s*:\s*([^,\n]+)(?:,|$)/g;
	for (const match of body.matchAll(fieldPattern)) {
		const declaration = match[2]!.trim();
		const [typePart, defaultPart] = declaration.split(/\s*=\s*/, 2);
		fields.push({ name: match[1]!, type: typePart!.trim(), hasDefault: defaultPart != null });
	}
	return fields;
}

function resolveSchemaShape(
	schema: Schema,
	schemas: Record<string, Schema>,
	seen = new Set<Schema>(),
): { properties: Set<string>; required: Set<string> } {
	if (seen.has(schema)) return { properties: new Set(), required: new Set() };
	seen.add(schema);
	const properties = new Set(Object.keys(schema.properties ?? {}));
	const required = new Set(schema.required ?? []);
	const refName = schema.$ref?.split('/').at(-1);
	const parts = [refName ? schemas[refName] : null, ...(schema.allOf ?? [])];
	for (const part of parts) {
		if (!part) continue;
		const resolved = resolveSchemaShape(part, schemas, seen);
		for (const property of resolved.properties) properties.add(property);
		for (const property of resolved.required) required.add(property);
	}
	return { properties, required };
}

function successResponseSchema(document: OpenApiDocument, operation: string): Schema | null {
	for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
		for (const [method, rawOperation] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method.toLowerCase()) || operationKey(method, path) !== operation) {
				continue;
			}
			const operationObject = rawOperation as {
				responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
			};
			const success = Object.entries(operationObject.responses ?? {})
				.filter(([status]) => /^2\d\d$/.test(status))
				.sort(([left], [right]) => left.localeCompare(right))[0]?.[1];
			return success?.content?.['application/json']?.schema ?? null;
		}
	}
	return null;
}

function schemaRefName(schema: Schema | null) {
	return schema?.$ref?.split('/').at(-1) ?? null;
}

export function compareAndroidOpenApiContract(
	document: OpenApiDocument,
	retrofitSource: string,
	modelsSource: string,
	options: AndroidContractOptions = {},
) {
	const errors: string[] = [];
	const retrofitResponses = extractRetrofitResponses(retrofitSource);
	const retrofitOperations = new Set(retrofitResponses.keys());
	const openApiOperations = extractOpenApiOperations(document);
	const coveredOutsideRetrofit = options.coveredOutsideRetrofit ?? new Set<string>();
	const intentionallyUnsupported = options.intentionallyUnsupported ?? new Set<string>();

	for (const operation of retrofitOperations) {
		if (!openApiOperations.has(operation))
			errors.push(`Android operation is missing from OpenAPI: ${operation}`);
	}
	for (const operation of openApiOperations) {
		if (
			!retrofitOperations.has(operation) &&
			!coveredOutsideRetrofit.has(operation) &&
			!intentionallyUnsupported.has(operation)
		) {
			errors.push(`OpenAPI operation has no declared Android coverage: ${operation}`);
		}
	}
	for (const operation of new Set([...coveredOutsideRetrofit, ...intentionallyUnsupported])) {
		if (!openApiOperations.has(operation)) {
			errors.push(`Declared Android coverage references a missing OpenAPI operation: ${operation}`);
		}
	}

	const schemas = document.components?.schemas ?? {};
	const schemaNameByKotlinClass = new Map(
		Object.entries(options.schemaMappings ?? {}).map(([schemaName, className]) => [
			className,
			schemaName,
		]),
	);
	for (const [operation, expectedModel] of Object.entries(options.responseMappings ?? {})) {
		const retrofitResponse = retrofitResponses.get(operation);
		if (!retrofitResponse) {
			errors.push(`Mapped Android response references a missing Retrofit operation: ${operation}`);
			continue;
		}
		if (retrofitResponse.modelName !== expectedModel) {
			errors.push(
				`Android response for ${operation} is ${retrofitResponse.modelName ?? retrofitResponse.returnType}, expected ${expectedModel}`,
			);
		}

		const responseSchema = successResponseSchema(document, operation);
		const dataSchema = responseSchema?.properties?.data ?? null;
		const payloadSchema = retrofitResponse.isCollection ? (dataSchema?.items ?? null) : dataSchema;
		if (!responseSchema || !dataSchema) {
			errors.push(`OpenAPI success response for ${operation} does not declare a JSON data schema`);
			continue;
		}
		if (retrofitResponse.isCollection && dataSchema.type !== 'array') {
			errors.push(`OpenAPI success response for ${operation} does not declare data as an array`);
			continue;
		}
		const expectedSchema = schemaNameByKotlinClass.get(expectedModel);
		if (!expectedSchema) {
			errors.push(`No OpenAPI schema mapping is declared for Android model ${expectedModel}`);
			continue;
		}
		const actualSchema = schemaRefName(payloadSchema);
		if (actualSchema !== expectedSchema) {
			errors.push(
				`OpenAPI success response for ${operation} declares ${actualSchema ?? 'an inline schema'}, expected ${expectedSchema} for Android ${expectedModel}`,
			);
		}
	}

	for (const [schemaName, className] of Object.entries(options.schemaMappings ?? {})) {
		const schema = schemas[schemaName];
		if (!schema) {
			errors.push(`Mapped OpenAPI schema does not exist: ${schemaName}`);
			continue;
		}
		const fields = extractDataClassFields(modelsSource, className);
		if (!fields) {
			errors.push(`Mapped Kotlin data class does not exist: ${className}`);
			continue;
		}
		const shape = resolveSchemaShape(schema, schemas);
		for (const field of fields) {
			if (!shape.properties.has(field.name)) {
				errors.push(`${className}.${field.name} is missing from OpenAPI schema ${schemaName}`);
			} else if (
				!field.type.endsWith('?') &&
				!field.hasDefault &&
				!shape.required.has(field.name)
			) {
				errors.push(
					`${className}.${field.name} is non-null without a default but is optional in OpenAPI schema ${schemaName}`,
				);
			}
		}
	}

	return errors;
}
