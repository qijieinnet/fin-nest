import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ApiExceptionFilter, BigIntSerializeInterceptor } from "@fin-nest/backend";
import { loadConfig, loadDotenv } from "@fin-nest/config";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  loadDotenv();
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);

  // web 走同源 /api 代理（开发 Next rewrites / 线上 nginx）后不再跨域；
  // 保留 CORS 仅为直连调试（Swagger、脚本）方便，凭证走 Authorization 头，无需 credentials。
  app.enableCors({ origin: config.WEB_ORIGIN });

  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.useGlobalInterceptors(app.get(BigIntSerializeInterceptor));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  // Swagger 无鉴权且经 /api 代理对外可达，生产环境不暴露 API 结构。
  const docsEnabled = config.NODE_ENV !== "production";
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Fin Nest API")
      .setDescription("Fin Nest REST API")
      .setVersion("0.1.0")
      .build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(config.API_PORT);
  console.log(`fin-nest-api listening on :${config.API_PORT}${docsEnabled ? " (docs at /docs)" : ""}`);
}

void bootstrap();
