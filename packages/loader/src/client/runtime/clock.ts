/**
 * 可注入时钟（T2.4 单测的确定性基础）。
 *
 * 超时路径（deactivate 10s / activate 10s / 恢复等待）绝不真实等待：
 * 测试注入 fake 时钟手动推进，生产用 globalThis 包装。
 */

/** 最小定时器面（handle 不透明）。 */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /**
   * 间隔句柄（可选：补齐器 settings 轮询用）。测试 fake 时钟可不实现——
   * 注入 fake 的测试自行驱动周期逻辑，或显式提供 interval。
   */
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
}

/** 生产默认：globalThis 定时器（Node 24 / 浏览器同形）。 */
export const defaultTimers: Timers = {
  setTimeout(fn, ms) {
    return globalThis.setTimeout(fn, ms);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]);
  },
  setInterval(fn, ms) {
    return globalThis.setInterval(fn, ms);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as Parameters<typeof globalThis.clearInterval>[0]);
  },
};

/** raceTimeout 的结果：value 到达 / promise 拒绝 / 超时。 */
export type RaceOutcome<T> =
  | { kind: "resolved"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "timeout" };

/**
 * 以「先到先得」的方式竞速一个 promise 与超时定时器。
 * 输 promise 的 settle（含拒绝）总是被消费——调用方负责随后自行 await 原始
 * promise 以取回具体错误；onTimeout 用于超时侧的旁路动作（如 abort signal）。
 */
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timers: Timers,
  onTimeout?: () => void,
): Promise<RaceOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: RaceOutcome<T>) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.clearTimeout(handle);
      resolve(outcome);
    };
    const handle = timers.setTimeout(() => {
      settle({ kind: "timeout" });
      onTimeout?.();
    }, ms);
    promise.then(
      (value) => settle({ kind: "resolved", value }),
      (error: unknown) => settle({ kind: "rejected", error }),
    );
  });
}
