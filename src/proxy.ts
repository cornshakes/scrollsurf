import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, cookie_options } from '@/lib/cookie';

export const proxy = (request: NextRequest) => {
  const res = NextResponse.next();
  const token = request.cookies.get(COOKIE_NAME)?.value ?? crypto.randomUUID();
  res.cookies.set(COOKIE_NAME, token, cookie_options());
  return res;
};

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
