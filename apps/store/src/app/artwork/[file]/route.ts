import { teeSvg } from '../../../lib/mockup';
import { COLOUR_STYLES } from '../../../lib/styles';
import { getArtworkSubject } from '../../../server/catalogue';
import { getDb } from '../../../server/db';

// GET /artwork/<slug>.svg?colour=<colour> — generated mockup for a published design.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const slug = file.endsWith('.svg') ? file.slice(0, -'.svg'.length) : null;
  const subject = slug ? await getArtworkSubject(getDb(), slug) : null;
  if (!subject) return Response.json({ error: 'not_found' }, { status: 404 });

  const requested = new URL(request.url).searchParams.get('colour') ?? 'black';
  const colour = requested in COLOUR_STYLES ? requested : 'black';

  return new Response(teeSvg({ text: subject.name, colour, style: subject.style }), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
