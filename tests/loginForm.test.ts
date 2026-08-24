import { describe, expect, it } from "vitest";
import {
  readLoginFormCredentials,
  shouldIgnoreAutomaticLoginSubmit,
  withTimeout,
} from "@/lib/loginForm";

describe("readLoginFormCredentials", () => {
  it("reads named email and password fields", () => {
    const formData = new FormData();
    formData.set("email", "  you@example.com ");
    formData.set("password", "secret123");
    expect(readLoginFormCredentials(formData)).toEqual({
      email: "you@example.com",
      password: "secret123",
    });
  });

  it("falls back to React state when autofill skipped name attributes", () => {
    expect(
      readLoginFormCredentials(new FormData(), {
        email: "you@example.com",
        password: "secret123",
      })
    ).toEqual({
      email: "you@example.com",
      password: "secret123",
    });
  });
});

describe("shouldIgnoreAutomaticLoginSubmit", () => {
  it("ignores submits before the user touches the form", () => {
    expect(
      shouldIgnoreAutomaticLoginSubmit({
        formArmed: false,
        email: "you@example.com",
        password: "secret123",
      })
    ).toBe(true);
  });

  it("ignores armed submits with empty credentials", () => {
    expect(
      shouldIgnoreAutomaticLoginSubmit({
        formArmed: true,
        email: "",
        password: "secret123",
      })
    ).toBe(true);
  });

  it("accepts an explicit user submit", () => {
    expect(
      shouldIgnoreAutomaticLoginSubmit({
        formArmed: true,
        email: "you@example.com",
        password: "secret123",
      })
    ).toBe(false);
  });
});

describe("withTimeout", () => {
  it("rejects when the promise never settles", async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 10, "too slow")
    ).rejects.toThrow("too slow");
  });

  it("resolves when the promise finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "too slow")).resolves.toBe(
      "ok"
    );
  });
});
