// Shared MediaWiki API client for the dataset download scripts and categorize.
// Follows API:Etiquette: serial requests, maxlag, a real user-agent, gzip, json,
// and exponential backoff on 429/503. Built on ky — the hand-rolled retry/backoff
// loop that wiki.ts and commons.ts used to each carry now lives here once.

import ky, { type AfterResponseHook } from 'ky';
import { setTimeout as sleep } from 'node:timers/promises';

const REQUEST_DELAY_MS = 500;

// maxlag throttling arrives as an HTTP 200 carrying an error body
// (`error.code === 'maxlag'`) rather than a real 503. This hook surfaces it as a
// synthetic 503 that re-uses the original `Retry-After` header, so ky's retry
// machinery backs off and retries maxlag exactly as it would a genuine 503.
//
// ky already hands the hook a clone of the response, but we clone again before
// reading the body so the untouched original stream survives for the non-retry
// path (when the hook returns nothing, ky keeps using the original response).
const maxlag_as_503: AfterResponseHook = async (_request, _options, response) => {
  if (!response.ok) {
    return; // genuine 4xx/5xx are handled by ky's status-code retry / throw path
  }
  const data = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null;
  if (data?.error?.code === 'maxlag') {
    return new Response(null, {
      status: 503,
      headers: { 'Retry-After': response.headers.get('Retry-After') ?? '5' },
    });
  }
};

// Builds a serial, etiquette-respecting POST client for a MediaWiki api.php
// endpoint. The returned function takes query params, sets maxlag, POSTs them,
// and resolves the parsed JSON body after the mandatory serial-pacing delay.
export const create_mediawiki_api = (api_url: string) => {
  const client = ky.create({
    headers: {
      'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)',
      'Accept-Encoding': 'gzip',
    },
    // POST must be listed explicitly — ky does not retry POST by default. Only
    // 429/503 retry (matching the previous behavior); Retry-After is honored by
    // the library for both, capped so a pathological header can't hang a script.
    retry: {
      limit: 2,
      methods: ['post'],
      statusCodes: [429, 503],
      maxRetryAfter: 60_000,
    },
    hooks: { afterResponse: [maxlag_as_503] },
  });

  return async (params: URLSearchParams): Promise<unknown> => {
    params.set('maxlag', '5');
    const data = await client.post(api_url, { body: params }).json();
    await sleep(REQUEST_DELAY_MS); // API-etiquette serial pacing
    return data;
  };
};
