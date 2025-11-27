/**
 * Fake external dependencies
 * In real code, these would be actual database clients, HTTP clients, etc.
 * These exist just to make the "before" example compile.
 */

export const db = {
  async query<T>(_sql: string, _params: unknown[]): Promise<T | null> {
    throw new Error('Not implemented - this is a fake');
  },
  async execute(_sql: string, _params: unknown[]): Promise<void> {
    throw new Error('Not implemented - this is a fake');
  },
};

export const httpClient = {
  async get<T>(_url: string): Promise<T> {
    throw new Error('Not implemented - this is a fake');
  },
  async post(_url: string, _body: unknown): Promise<void> {
    throw new Error('Not implemented - this is a fake');
  },
};

export const cache = {
  async set(_key: string, _value: string, _ttl: number): Promise<void> {
    throw new Error('Not implemented - this is a fake');
  },
  async get(_key: string): Promise<string | null> {
    throw new Error('Not implemented - this is a fake');
  },
};

export const emailService = {
  async send(_payload: { to: string; subject: string; body: string }): Promise<void> {
    throw new Error('Not implemented - this is a fake');
  },
};
