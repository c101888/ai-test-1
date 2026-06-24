// better-sqlite3 模块声明
// 由于 better-sqlite3 是原生模块且仅在运行时动态导入，
// 这里提供最小类型声明以通过 TypeScript 编译检查
declare module "better-sqlite3" {
  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: unknown) => void;
  }

  interface Statement {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  }

  class Database {
    constructor(path: string, options?: DatabaseOptions);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
    pragma(source: string, options?: { simple?: boolean }): unknown;
  }

  export default Database;
}
