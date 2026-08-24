/** Values read from the live form so browser autofill is not lost to React state. */
export type LoginFormCredentials = {
  email: string;
  password: string;
};

export function readLoginFormCredentials(
  formData: FormData,
  fallback: Partial<LoginFormCredentials> = {}
): LoginFormCredentials {
  const email = String(
    formData.get("email") ?? fallback.email ?? ""
  ).trim();
  const password = String(formData.get("password") ?? fallback.password ?? "");
  return { email, password };
}

/**
 * Password managers (Chrome Auto Sign-in, iOS Keychain) can submit the login
 * form as soon as the page hydrates — no tap on Sign in. Ignore those until
 * the user has actually touched this form.
 */
export function shouldIgnoreAutomaticLoginSubmit(options: {
  formArmed: boolean;
  email: string;
  password: string;
}): boolean {
  if (!options.formArmed) return true;
  if (!options.email || !options.password) return true;
  return false;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
