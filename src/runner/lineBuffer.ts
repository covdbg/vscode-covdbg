/**
 * Turns a stream's chunks into whole lines. A pipe can split a line anywhere, so what covdbg
 * prints is only read once the line is complete.
 */
export class LineBuffer {
    private pending = "";

    constructor(private readonly onLine: (line: string) => void) {}

    push(chunk: string | Buffer): void {
        const lines = (this.pending + String(chunk)).split(/\r?\n/);
        this.pending = lines.pop() ?? "";
        lines.forEach((line) => this.onLine(line));
    }

    /** Emits what is left once the stream has ended without a final newline. */
    flush(): void {
        if (this.pending) {
            const line = this.pending;
            this.pending = "";
            this.onLine(line);
        }
    }
}
