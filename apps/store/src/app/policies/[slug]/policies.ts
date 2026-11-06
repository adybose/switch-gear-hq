// Policy pages, written from docs/spec.md. This is a demo store: nothing here is a real
// commitment to a real customer.

export interface Policy {
  title: string;
  sections: { heading: string; body: string[] }[];
}

export const POLICIES: Record<string, Policy> = {
  shipping: {
    title: 'Shipping',
    sections: [
      {
        heading: 'Cost',
        body: ['Shipping is free on orders of ₹999 or more. Below that it costs ₹79.'],
      },
      {
        heading: 'When your order arrives',
        body: [
          'Every tee is printed to order. Printing takes up to 2 business days after payment.',
          'Delivery then takes about 1 day within Bengaluru, 3 days within our courier zone and 5 days to the rest of India.',
          'Your tracking number is shown on the order page as soon as the parcel is picked up.',
        ],
      },
      {
        heading: 'Where we deliver',
        body: [
          'We check your PIN code at checkout. If our courier does not serve it yet, we tell you before you pay.',
          'If a delivery attempt fails, the courier tries twice more before returning the parcel to us. We then reship it or refund you.',
        ],
      },
    ],
  },
  returns: {
    title: 'Returns and refunds',
    sections: [
      {
        heading: 'Cancelling',
        body: ['You can cancel for a full refund until printing starts.'],
      },
      {
        heading: 'Returns',
        body: [
          'If a tee does not fit or arrives with a defect, ask for a return within 7 days of delivery.',
          'Once the parcel is back with us we refund the amount you paid and issue a credit note against your invoice.',
          'Misprints are reprinted free of charge.',
        ],
      },
      {
        heading: 'Refunds',
        body: [
          'Refunds go back to the original payment method. Larger refunds are checked by the founder first, which can add a day.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms',
    sections: [
      {
        heading: 'Demo store',
        body: [
          'Switch Gear is a fictional brand built for a hackathon. Payments, printing and deliveries are simulated. No real money changes hands and nothing is shipped.',
        ],
      },
      {
        heading: 'Prices',
        body: [
          'Prices are in Indian rupees and include GST. A GST invoice is issued for every order.',
          'Any 3 tees get 10% off automatically. Orders are prepaid; cash on delivery is not offered.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy',
    sections: [
      {
        heading: 'What we keep',
        body: [
          'To fulfil an order we keep your name, email, phone number and delivery address, and share the address with our print and courier partners.',
          'This is a demo store: please use made-up details. Test customers use @example.com addresses.',
        ],
      },
      {
        heading: 'What we do not do',
        body: [
          'We do not sell your data or show you third-party ads, and we never see card details.',
        ],
      },
    ],
  },
};
