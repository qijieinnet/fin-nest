import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { getPrisma, PrismaClient } from "@fin-nest/db";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = getPrisma();

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
