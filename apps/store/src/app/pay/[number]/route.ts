import { businessClock } from '@switch-gear/shared/clock';
import { getDb } from '../../../server/db';
import { orderPath, verifyOrderToken } from '../../../server/order-link';
import { openPayment, PaymentUnavailable } from '../../../server/paymock';

// GET /pay/ORD-1001?t=<order token> — checkout's paymentUrl. Opens the order's PayMock payment
// and sends the customer to its pay page; the order page links here again ("Pay now").
// If the order is no longer waiting for payment, or PayMock is down, it goes to the order page.

const DEFAULT_SIM_URL = 'http://localhost:4000';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ number: string }> },
): Promise<Response> {
  const { number } = await params;
  const token = new URL(request.url).searchParams.get('t');
  if (!verifyOrderToken(number, token)) {
    return new Response('Not found', { status: 404 });
  }

  const orderUrl = new URL(orderPath(number), request.url);
  try {
    const payment = await openPayment(getDb(), number, {
      simUrl: process.env.SIM_URL || DEFAULT_SIM_URL,
      speed: (await businessClock().read()).speed,
      returnUrl: orderUrl.toString(),
    });
    if (!payment) return Response.redirect(orderUrl, 303);
    // The browser needs the sim's public address, which differs from SIM_URL inside Docker.
    const publicSim = process.env.SIM_PUBLIC_URL || DEFAULT_SIM_URL;
    return Response.redirect(new URL(payment.payPath, publicSim), 303);
  } catch (err) {
    if (!(err instanceof PaymentUnavailable)) throw err;
    console.error(`[pay] ${number}: ${err.message}`);
    orderUrl.searchParams.set('payment', 'unavailable');
    return Response.redirect(orderUrl, 303);
  }
}
