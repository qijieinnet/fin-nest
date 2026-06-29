import { Injectable } from "@nestjs/common";
import { Prisma } from "@fin-nest/db";
import { PrismaService } from "../prisma/prisma.service";

export type PrismaTransactionClient = Prisma.TransactionClient;

@Injectable()
export class DatabaseTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    fn: (tx: PrismaTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.prisma.client.$transaction(fn, options);
  }
}
