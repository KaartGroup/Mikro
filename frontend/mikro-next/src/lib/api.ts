/**
 * API client for communicating with the Flask backend.
 *
 * This module handles all HTTP requests to the backend, including
 * authentication token management.
 */

const BACKEND_URL = process.env.FLASK_BACKEND_URL || "http://localhost:5004";

interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  status: number;
}

/**
 * Fetch data from the Flask backend with authentication.
 *
 * @param endpoint - The API endpoint (without /api prefix)
 * @param options - Fetch options
 * @param accessToken - Auth0 access token
 * @returns The API response
 */
export async function fetchFromBackend<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  accessToken?: string | null,
): Promise<ApiResponse<T>> {
  const url = `${BACKEND_URL}/api${endpoint}`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (accessToken) {
    (headers as Record<string, string>)["Authorization"] =
      `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        error: errorData.message || `API error: ${response.status}`,
        status: response.status,
      };
    }

    const data = await response.json();
    return {
      data,
      status: response.status,
    };
  } catch (error) {
    console.error("API request failed:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}

/**
 * POST request to the Flask backend.
 */
export async function postToBackend<T = unknown>(
  endpoint: string,
  body: unknown,
  accessToken?: string | null,
): Promise<ApiResponse<T>> {
  return fetchFromBackend<T>(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    accessToken,
  );
}

/**
 * GET request to the Flask backend.
 */
export async function getFromBackend<T = unknown>(
  endpoint: string,
  accessToken?: string | null,
): Promise<ApiResponse<T>> {
  return fetchFromBackend<T>(
    endpoint,
    {
      method: "GET",
    },
    accessToken,
  );
}
