import { EventEmitter } from "events";
import type { SpawnCovdbg } from "../runner/signIn";

/** A covdbg process the test drives: it prints and exits when told to. */
export class FakeProcess extends EventEmitter {
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    killed = false;

    constructor(
        readonly args: string[],
        readonly env: NodeJS.ProcessEnv,
    ) {
        super();
    }

    print(text: string): void {
        this.stdout.emit("data", Buffer.from(text));
    }

    exit(code: number | null): void {
        this.emit("close", code);
    }

    kill(): boolean {
        this.killed = true;
        setImmediate(() => this.exit(null));
        return true;
    }
}

/** Stands in for spawning covdbg. `script` runs on the next tick for every process started. */
export function fakeCovdbg(script: (process: FakeProcess) => void): {
    start: SpawnCovdbg;
    started: FakeProcess[];
} {
    const started: FakeProcess[] = [];
    const start: SpawnCovdbg = (_executablePath, args, env) => {
        const process = new FakeProcess(args, env);
        started.push(process);
        setImmediate(() => script(process));
        return process;
    };
    return { start, started };
}

/** Lets pending callbacks and timers of zero length run. */
export function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}
