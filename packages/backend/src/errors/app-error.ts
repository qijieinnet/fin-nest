import { HttpStatus } from "@nestjs/common";

export type ErrorDetails = Record<string, unknown> | undefined;

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: ErrorDetails;

  constructor(code: string, message: string, statusCode = HttpStatus.BAD_REQUEST, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function internalError(message = "服务暂时不可用", details?: ErrorDetails): AppError {
  return new AppError("INTERNAL_ERROR", message, HttpStatus.INTERNAL_SERVER_ERROR, details);
}
