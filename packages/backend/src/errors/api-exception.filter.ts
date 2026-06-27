import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { AppError } from "./app-error";

type ErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type HttpResponse = {
  status(statusCode: number): {
    json(body: ErrorBody): void;
  };
};

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const { statusCode, body } = this.toErrorResponse(exception);
    response.status(statusCode).json(body);
  }

  private toErrorResponse(exception: unknown): { statusCode: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.statusCode,
        body: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();
      return {
        statusCode,
        body: {
          code: this.httpStatusToCode(statusCode),
          message: this.extractHttpMessage(payload, exception.message),
          details: typeof payload === "object" && payload !== null ? { original: payload } : undefined,
        },
      };
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : `Unknown exception: ${String(exception)}`,
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用",
      },
    };
  }

  private fromPrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): { statusCode: number; body: ErrorBody } {
    switch (exception.code) {
      case "P2002": {
        const target = exception.meta?.target;
        return {
          statusCode: HttpStatus.CONFLICT,
          body: {
            code: "DUPLICATE_RESOURCE",
            message: "记录已存在",
            details: target ? { fields: target } : undefined,
          },
        };
      }
      case "P2025":
        return {
          statusCode: HttpStatus.NOT_FOUND,
          body: { code: "RESOURCE_NOT_FOUND", message: "记录不存在" },
        };
      case "P2003":
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          body: { code: "FOREIGN_KEY_VIOLATION", message: "关联记录不存在" },
        };
      default:
        this.logger.error(`Unhandled Prisma error ${exception.code}: ${exception.message}`);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { code: "INTERNAL_ERROR", message: "服务暂时不可用" },
        };
    }
  }

  private extractHttpMessage(payload: string | object, fallback: string): string {
    if (typeof payload === "string") return payload;
    if ("message" in payload) {
      const message = payload.message;
      if (Array.isArray(message)) return message.join("; ");
      if (typeof message === "string") return message;
    }
    return fallback;
  }

  private httpStatusToCode(statusCode: number): string {
    const name = HttpStatus[statusCode] as string | undefined;
    return name ? name.replace(/ /g, "_") : "HTTP_ERROR";
  }
}
