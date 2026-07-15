const HTTP_METHODS = new Set(['get', 'post', 'patch', 'delete', 'put']);

type Schema = {
	$ref?: string;
	allOf?: Schema[];
	required?: string[];
	properties?: Record<string, unknown>;
};

type OpenApiDocument = {
	paths?: Record<string, Record<string, unknown>>;
	components?: { schemas?: Record<string, Schema> };
};

export interface AndroidContractOptions {
	coveredOutsideRetrofit?: ReadonlySet<string>;
	intentionallyUnsupported?: ReadonlySet<string>;
	schemaMappings?: Readonly<Record<string, string>>;
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
	const operations = new Set<string>();
	const annotation = /@(GET|POST|PATCH|DELETE|PUT)\("([^"]+)"\)/g;
	for (const match of source.matchAll(annotation)) {
		operations.add(operationKey(match[1]!, match[2]!));
	}
	return operations;
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

export function compareAndroidOpenApiContract(
	document: OpenApiDocument,
	retrofitSource: string,
	modelsSource: string,
	options: AndroidContractOptions = {},
) {
	const errors: string[] = [];
	const retrofitOperations = extractRetrofitOperations(retrofitSource);
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
