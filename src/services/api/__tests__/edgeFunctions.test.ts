import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';
import { EdgeFunctionError, deleteAccount } from '../edgeFunctions';

const mockInvoke = jest.fn();
jest.mock('../supabaseClient', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('invokeFunction error handling', () => {
  it('surfaces the server-provided error message when the response body is real JSON', async () => {
    const context = { json: async () => ({ error: 'Something specific went wrong.' }) };
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    await expect(deleteAccount()).rejects.toMatchObject({
      message: 'Something specific went wrong.',
    });
  });

  it('never leaks the raw Supabase SDK string when the error body is not JSON — this is the reported bug', async () => {
    const context = { json: async () => { throw new Error('not json'); } };
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(context) });

    await expect(deleteAccount()).rejects.toMatchObject({
      message: 'Something went wrong reaching the server. Please try again in a moment.',
    });
    // The exact assertion that matters: the old literal SDK message must
    // never reach the UI.
    await expect(deleteAccount()).rejects.not.toMatchObject({
      message: 'Edge Function returned a non-2xx status code',
    });
  });

  it('gives the same friendly message for a network-level failure (function unreachable/not deployed)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError({}) });

    await expect(deleteAccount()).rejects.toBeInstanceOf(EdgeFunctionError);
    await expect(deleteAccount()).rejects.toMatchObject({
      message: 'Something went wrong reaching the server. Please try again in a moment.',
    });
  });

  it('resolves with the data on success', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(deleteAccount()).resolves.toEqual({ ok: true });
  });
});
