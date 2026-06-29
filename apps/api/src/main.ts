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

  // 浏览器端 web 直连 API 为跨域请求；放行 WEB_ORIGIN 并允许携带 session cookie。
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });

  app.useGlobalFilters(app.get(ApiExceptionFilter));
  app.useGlobalInterceptors(app.get(BigIntSerializeInterceptor));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Fin Nest API")
    .setDescription("Fin Nest REST API")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(config.API_PORT);
  console.log(`fin-nest-api listening on :${config.API_PORT} (docs at /docs)`);
}

void bootstrap();
