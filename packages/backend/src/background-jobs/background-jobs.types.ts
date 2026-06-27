import { Prisma } from "@fin-nest/db";

export type BackgroundJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type EnqueueBackgroundJobInput = {
  type: string;
  payload: Prisma.InputJsonValue;
  runAfter?: Date;
  maxAttempts?: number;
};

export type ClaimedBackgroundJob = {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  payload: Prisma.JsonValue;
  runAfter: Date;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RawBackgroundJob = {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  payload: Prisma.JsonValue;
  run_after: Date;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};
