import { z } from 'zod';
import { apiProducts } from '../../../../../../server/catalogue';
import { getDb } from '../../../../../../server/db';
import { errorResponse } from '../../../../../../server/http';

const slugInput = z.string().min(1).max(100);
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const slug = slugInput.safeParse((await params).slug);
  if (!slug.success) return errorResponse(422, 'validation_failed');
  const [product] = await apiProducts(getDb(), { slug: slug.data });
  return product ? Response.json(product) : errorResponse(404, 'not_found');
}
