import { handleMcpRequest } from '@/features/studio-mcp/http/handle-request';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const OPTIONS = handleMcpRequest;
