import { describe, expect, it } from 'vitest';
import {
	compareAndroidOpenApiContract,
	extractRetrofitOperations,
	operationKey,
} from '../../src/openapi/android-contract.js';

const retrofit = `
interface Api {
  @GET("articles/{id}")
  suspend fun article(@Path("id") id: String): Article
}
`;

const models = `
data class Article(
  val id: String,
  val title: String,
  val excerpt: String? = null,
)
`;

function document() {
	const paths: Record<string, Record<string, object>> = {
		'/articles/{articleId}': { get: {} },
	};
	const schemas: Record<
		string,
		{ type: string; required: string[]; properties: Record<string, object> }
	> = {
		Article: {
			type: 'object',
			required: ['id', 'title'],
			properties: { id: {}, title: {}, excerpt: {} },
		},
	};
	return {
		paths,
		components: { schemas },
	};
}

describe('Android/OpenAPI contract compatibility', () => {
	it('normalizes path parameter names across Retrofit and OpenAPI', () => {
		expect(extractRetrofitOperations(retrofit)).toEqual(
			new Set([operationKey('GET', '/articles/{articleId}')]),
		);
		expect(
			compareAndroidOpenApiContract(document(), retrofit, models, {
				schemaMappings: { Article: 'Article' },
			}),
		).toEqual([]);
	});

	it('reports endpoint drift in both directions unless coverage is explicit', () => {
		const changed = document();
		changed.paths = {
			'/feeds': { get: {} },
		};

		expect(compareAndroidOpenApiContract(changed, retrofit, models)).toEqual([
			'Android operation is missing from OpenAPI: GET /articles/{param}',
			'OpenAPI operation has no declared Android coverage: GET /feeds',
		]);
		expect(
			compareAndroidOpenApiContract(changed, '', models, {
				intentionallyUnsupported: new Set([operationKey('GET', '/feeds')]),
			}),
		).toEqual([]);
	});

	it('reports stale alternate-transport and unsupported-operation declarations', () => {
		expect(
			compareAndroidOpenApiContract(document(), retrofit, models, {
				coveredOutsideRetrofit: new Set([operationKey('POST', '/auth/refresh')]),
				intentionallyUnsupported: new Set([operationKey('POST', '/admin/users')]),
			}),
		).toEqual([
			'Declared Android coverage references a missing OpenAPI operation: POST /auth/refresh',
			'Declared Android coverage references a missing OpenAPI operation: POST /admin/users',
		]);
	});

	it('reports Kotlin fields that are absent or unsafe to deserialize', () => {
		const changed = document();
		changed.components.schemas.Article = {
			type: 'object',
			required: ['id'],
			properties: { id: {}, title: {} },
		};

		expect(
			compareAndroidOpenApiContract(changed, retrofit, models, {
				schemaMappings: { Article: 'Article' },
			}),
		).toEqual([
			'Article.title is non-null without a default but is optional in OpenAPI schema Article',
			'Article.excerpt is missing from OpenAPI schema Article',
		]);
	});

	it('resolves inherited allOf properties and required fields', () => {
		const inherited = {
			paths: {},
			components: {
				schemas: {
					BaseArticle: {
						type: 'object',
						required: ['id'],
						properties: { id: {} },
					},
					Article: {
						allOf: [
							{ $ref: '#/components/schemas/BaseArticle' },
							{
								type: 'object',
								required: ['title'],
								properties: { title: {}, excerpt: {} },
							},
						],
					},
				},
			},
		};

		expect(
			compareAndroidOpenApiContract(inherited, '', models, {
				schemaMappings: { Article: 'Article' },
			}),
		).toEqual([]);
	});

	it('checks Retrofit payload types against each mapped OpenAPI success response', () => {
		const feedRetrofit = `
interface Api {
  @POST("feeds")
  suspend fun createFeed(): ApiEnvelope<FeedWithCounts>
}
`;
		const feedModels = `
data class FeedWithCounts(
  val id: String,
  val unreadCount: Int,
)
`;
		const changed = {
			paths: {
				'/feeds': {
					post: {
						responses: {
							'201': {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												data: { $ref: '#/components/schemas/Feed' },
											},
										},
									},
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					Feed: { type: 'object', required: ['id'], properties: { id: {} } },
					FeedWithCounts: {
						type: 'object',
						required: ['id', 'unreadCount'],
						properties: { id: {}, unreadCount: {} },
					},
				},
			},
		};

		expect(
			compareAndroidOpenApiContract(changed, feedRetrofit, feedModels, {
				schemaMappings: { FeedWithCounts: 'FeedWithCounts' },
				responseMappings: {
					[operationKey('POST', '/feeds')]: 'FeedWithCounts',
				},
			}),
		).toContain(
			'OpenAPI success response for POST /feeds declares Feed, expected FeedWithCounts for Android FeedWithCounts',
		);
	});
});
