export function checkNativeBuildEnv(env: Record<string, string | undefined>): { errors: string[]; warnings: string[] };
export function checkNativeDist(indexHtml: string): string[];
