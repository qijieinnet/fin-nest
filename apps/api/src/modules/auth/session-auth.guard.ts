import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AppError } from "@fin-nest/backend";
import { AuthService } from "./auth.service";
import { RequestWithAuth } from "./auth.types";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    request.auth = await this.authService.authenticateSessionRequest(request);
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.auth ?? (await this.authService.authenticateSessionRequest(request));
    if (auth.kind !== "session" || !auth.isAdmin) {
      throw new AppError("ADMIN_REQUIRED", "需要管理员权限", 403);
    }
    request.auth = auth;
    return true;
  }
}
