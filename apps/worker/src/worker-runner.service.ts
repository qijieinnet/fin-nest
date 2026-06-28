import { Injectable } from "@nestjs/common";
import { AutoSchedulerService } from "./automation/auto-scheduler.service";

@Injectable()
export class WorkerRunnerService {
  constructor(private readonly autoScheduler: AutoSchedulerService) {}

  async runOnce(): Promise<{ processed: number; created: number }> {
    return this.autoScheduler.runDueJobs();
  }
}
