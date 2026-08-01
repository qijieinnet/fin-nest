import { ApiProperty } from "@nestjs/swagger";
import { IsObject } from "class-validator";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

// WebAuthn 响应是浏览器按规范生成的嵌套结构，逐字段声明既臃肿又容易随规范演进过时；
// 这里只做「是个对象」的浅校验（不加 @ValidateNested，全局 whitelist 便不会剥掉内层字段），
// 真正的合法性由 @simplewebauthn/server 验签时判定。

export class RegisterAppLockCredentialDto {
  @ApiProperty({ description: "navigator.credentials.create() 的响应（startRegistration 返回值）" })
  @IsObject()
  response!: RegistrationResponseJSON;
}

export class VerifyAppLockCredentialDto {
  @ApiProperty({ description: "navigator.credentials.get() 的响应（startAuthentication 返回值）" })
  @IsObject()
  response!: AuthenticationResponseJSON;
}
