import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as docker from "@pulumi/docker";
import * as random from "@pulumi/random";
import * as std from "@pulumi/std";

// Import the program's configuration settings.
const config = new pulumi.Config();
const imageName = config.get("imageName") || "my-app";
const appPath = config.get("appPath") || "./app";
const containerPort = config.getNumber("containerPort") || 8080;
const cpu = config.getNumber("cpu") || 1;
const memory = config.get("memory") || "1Gi";
const concurrency = config.getNumber("concurrency") || 80;

// Import the provider's configuration settings.
const gcpConfig = new pulumi.Config("gcp");
const location = gcpConfig.require("region");
const project = gcpConfig.require("project");

// Generate a unique Artifact Registry repository ID
const uniqueString = new random.RandomString("unique-string", {
  length: 4,
  lower: true,
  upper: false,
  numeric: true,
  special: false,
});
let repoId = uniqueString.result.apply((result) => "repo-" + result);

// Create an Artifact Registry repository
const repository = new gcp.artifactregistry.Repository("repository", {
  description: "Repository for container image",
  format: "DOCKER",
  location: location,
  repositoryId: repoId,
});

// Form the repository URL
let repoUrl = pulumi.concat(
  location,
  "-docker.pkg.dev/",
  project,
  "/",
  repository.repositoryId
);

// Create a container image for the service.
// Before running `pulumi up`, configure Docker for authentication to Artifact Registry
// as described here: https://cloud.google.com/artifact-registry/docs/docker/authentication
const image = new docker.Image("image", {
  imageName: pulumi.concat(repoUrl, "/", imageName),
  build: {
    context: appPath,
    platform: "linux/amd64",
    args: {
      // Cloud Run currently requires x86_64 images
      // https://cloud.google.com/run/docs/container-contract#languages
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    },
  },
});

// Create a Cloud Run service definition.
const service = new gcp.cloudrun.Service("service", {
  location,
  template: {
    spec: {
      containers: [
        {
          image: image.repoDigest,
          resources: {
            limits: {
              memory,
              cpu: cpu.toString(),
            },
          },
          ports: [
            {
              containerPort,
            },
          ],
        },
      ],
      containerConcurrency: concurrency,
    },
  },
});

// Create an IAM member to allow the service to be publicly accessible.
const invoker = new gcp.cloudrun.IamMember("invoker", {
  location,
  service: service.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

// Create an API Gateway
const apiCfg = new gcp.apigateway.Api("api_cfg", { apiId: "my-api" });

// Create an API Gateway configuration from an OpenAPI specification
const apiCfgApiConfig = new gcp.apigateway.ApiConfig("api_cfg", {
  api: apiCfg.apiId,
  apiConfigId: "my-config",
  openapiDocuments: [
    {
      document: {
        path: "spec.yaml",
        contents: std
          .filebase64({
            input: "openapi.yaml",
          })
          .then((invoke) => invoke.result),
      },
    },
  ],
});

// API Gatewayのゲートウェイを作成
const apiGateway = new gcp.apigateway.Gateway("api-gateway", {
  apiConfig: apiCfgApiConfig.id,
  gatewayId: "my-gateway",
});

// ゲートウェイのホスト名を取得
const gatewayHostname = apiGateway.defaultHostname;

// ゲートウェイのURLを出力
export const gatewayUrl = pulumi.interpolate`https://${gatewayHostname}`;

// Export the URL of the service.
export const cloudRunServiceUrl = service.statuses.apply(
  (statuses) => statuses[0]?.url
);
