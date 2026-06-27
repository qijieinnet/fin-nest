import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthContext, RequestWithAuth } from "./auth.types";

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!request.auth) {
    throw new Error("Auth context is missing");
  }
  return request.auth;
});
