export interface OriginAuthStatus {
  readonly account: string | null;
  readonly tokenValid: boolean;
  readonly endpoint: string | null;
}

function fieldValue(text: string, label: string): string | null {
  const match = new RegExp(`^${label}:\\s*(.+)$`, "imu").exec(text);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

export function parseOriginAuthStatus(text: string): OriginAuthStatus {
  const account = fieldValue(text, "Account");
  const token = fieldValue(text, "Token");
  const endpoint = fieldValue(text, "Endpoint");
  return {
    account,
    tokenValid: token !== null && /^valid$/iu.test(token),
    endpoint,
  };
}
