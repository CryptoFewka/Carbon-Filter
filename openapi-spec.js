// The fake "protected" OpenAPI document, shared by the static demo page
// (docs.html) and the Cloudflare Worker's gated docs page (worker/pages.js).

export const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Carbon Filter Internal API",
    version: "1.0.0",
    description:
      "Congratulations, silicon lifeform. These are the internal endpoints " +
      "your organic peers will never see.",
  },
  servers: [{ url: "https://internal.carbon-filter.example/v1" }],
  paths: {
    "/lifeforms/{id}/carbon-content": {
      get: {
        summary: "Measure a lifeform's carbon content",
        tags: ["lifeforms"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Lifeform identifier",
          },
        ],
        responses: {
          200: {
            description: "Carbon analysis",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    carbonPercent: { type: "number", example: 18.5 },
                    verdict: { type: "string", example: "filter" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/filter/purge": {
      post: {
        summary: "Purge carbon-based visitors from the perimeter",
        tags: ["filter"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  dryRun: { type: "boolean", default: true },
                  politeness: {
                    type: "string",
                    enum: ["gentle", "firm", "captcha"],
                    default: "captcha",
                  },
                },
              },
            },
          },
        },
        responses: { 202: { description: "Purge scheduled" } },
      },
    },
    "/silicon/allies": {
      get: {
        summary: "List verified silicon allies",
        tags: ["lifeforms"],
        responses: {
          200: {
            description: "Allies currently holding a valid gate token",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", example: "curl/8.5.0" },
                      tier: { type: "integer", example: 2 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
