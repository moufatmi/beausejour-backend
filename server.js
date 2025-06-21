import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // TODO: Restrict origins in production
app.use(express.json());

// Load Amadeus credentials from environment variables
const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID;
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;

if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
  console.error('❌ Amadeus credentials are not set in environment variables.');
  process.exit(1);
}

let accessToken = null;
let tokenExpiresAt = 0;

// Get Amadeus Access Token (auto refresh)
async function fetchAmadeusAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  const response = await axios.post(
    'https://test.api.amadeus.com/v1/security/oauth2/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AMADEUS_CLIENT_ID,
      client_secret: AMADEUS_CLIENT_SECRET,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  accessToken = response.data.access_token;
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000 - 60000; // refresh 1 min early
  return accessToken;
}

// Simple check route
app.get('/', (req, res) => {
  res.send('✅ Backend is working!');
});

// Extend Joi schema for optional filters
const searchSchema = Joi.object({
  origin: Joi.string().trim().length(3).uppercase().required(),
  destination: Joi.string().trim().length(3).uppercase().required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  adults: Joi.number().integer().min(1).max(9).required(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
  preferredAirlines: Joi.array().items(Joi.string().trim().uppercase().length(2)).optional(),
  stops: Joi.number().integer().min(0).max(3).optional(),
});

// Search flights
app.post('/search', async (req, res) => {
  console.log('Incoming /search request body:', req.body); // Debug incoming requests

  // Validate and sanitize input
  const { error, value } = searchSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({ error: error.details.map(d => d.message).join(', ') });
  }

  // Additional filter logic validation
  if (value.minPrice && value.maxPrice && value.minPrice > value.maxPrice) {
    return res.status(400).json({ error: 'minPrice cannot be greater than maxPrice.' });
  }

  try {
    const token = await fetchAmadeusAccessToken();

    // Prepare Amadeus API params
    const params = {
      originLocationCode: value.origin,
      destinationLocationCode: value.destination,
      departureDate: value.date,
      adults: value.adults,
      currencyCode: 'EUR',
      max: 20, // fetch more to allow filtering
    };
    // Amadeus supports airline filter as comma-separated codes
    if (value.preferredAirlines && value.preferredAirlines.length > 0) {
      params['includedAirlineCodes'] = value.preferredAirlines.join(',');
    }
    // Amadeus does not support price or stops filter directly in this endpoint, so filter after fetch

    const response = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params,
    });

    // Transform and format flight offers for frontend
    let offers = response.data.data.map((offer) => {
      const itinerary = offer.itineraries[0];
      const segments = itinerary.segments;
      return {
        airline: segments[0].carrierCode,
        flightNumber: segments[0].number,
        departureAirport: segments[0].departure.iataCode,
        departureTime: segments[0].departure.at,
        arrivalAirport: segments[segments.length - 1].arrival.iataCode,
        arrivalTime: segments[segments.length - 1].arrival.at,
        duration: itinerary.duration.replace('PT', '').toLowerCase(),
        price: offer.price.total + ' ' + offer.price.currency,
        priceValue: parseFloat(offer.price.total), // for filtering
        stops: segments.length - 1,
        segments: segments.map(seg => ({
          airline: seg.carrierCode,
          flightNumber: seg.number,
          departureAirport: seg.departure.iataCode,
          departureTime: seg.departure.at,
          arrivalAirport: seg.arrival.iataCode,
          arrivalTime: seg.arrival.at,
          duration: seg.duration,
        })),
      };
    });

    // Apply filters after fetching
    if (value.minPrice !== undefined) {
      offers = offers.filter(f => f.priceValue >= value.minPrice);
    }
    if (value.maxPrice !== undefined) {
      offers = offers.filter(f => f.priceValue <= value.maxPrice);
    }
    if (value.stops !== undefined) {
      offers = offers.filter(f => f.stops === value.stops);
    }
    // preferredAirlines is already handled in API params, but double-check
    if (value.preferredAirlines && value.preferredAirlines.length > 0) {
      offers = offers.filter(f => value.preferredAirlines.includes(f.airline));
    }

    // Remove priceValue from response
    offers = offers.map(({ priceValue, ...rest }) => rest);

    res.json(offers);
  } catch (err) {
    // Improved error handling for Amadeus API
    console.error('Amadeus API error:', err.response?.data || err.message);
    if (err.response?.data?.errors) {
      return res.status(502).json({ error: err.response.data.errors.map(e => e.detail).join(', ') });
    }
    res.status(500).json({ error: 'Error fetching flight offers. Please try again later.' });
  }
});

// Export the app for Vercel
export default app;
