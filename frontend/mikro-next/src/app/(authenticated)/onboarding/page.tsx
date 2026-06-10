"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  useToastActions,
} from "@/components/ui";
import { useRole } from "@/contexts/RoleContext";

export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToastActions();
  const { paymentsVisible } = useRole();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [osmUsername, setOsmUsername] = useState("");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Steps: 1=OSM, 2=Payment (skip if !paymentsVisible), 3=Location, 4=Terms, 5=Done
  const totalSteps = paymentsVisible ? 5 : 4;

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleNext = () => {
    if (step === 1 && !osmUsername) {
      toast.error("Please enter your OSM username to continue");
      return;
    }
    if (step === 2 && (!paymentEmail || !validateEmail(paymentEmail))) {
      toast.error("Please enter a valid Payoneer email address");
      return;
    }
    if (step === 3 && (!country || !city)) {
      toast.error("Please enter your country and city");
      return;
    }
    if (step === 4 && !termsAccepted) {
      toast.error("Please accept the terms of service to continue");
      return;
    }
    // Skip payment step if payments not visible
    if (step === 1 && !paymentsVisible) {
      setStep(3);
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    // Skip payment step if payments not visible
    if (step === 3 && !paymentsVisible) {
      setStep(1);
    } else {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch("/backend/user/first_login_update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osm_username: osmUsername,
          payment_email: paymentEmail,
          country,
          city,
          terms_accepted: termsAccepted,
        }),
      });
      if (response.ok) {
        // Route via "/" so the role-aware landing redirect picks the
        // correct dashboard. Hardcoding /user/dashboard here previously
        // dropped newly onboarded admins on the user dashboard.
        router.push("/");
      } else {
        toast.error("Failed to save your information. Please try again.");
      }
    } catch (error) {
      console.error("Failed to submit onboarding:", error);
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-kaart-orange">Mikro</h1>
          <p className="text-muted-foreground mt-2">
            Welcome! Let&apos;s get you set up.
          </p>
        </div>

        {/* Progress */}
        <div className="flex justify-center gap-2 mb-6">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-2 w-8 rounded-full transition-colors ${
                i + 1 <= step ? "bg-kaart-orange" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {step === 1 && "OpenStreetMap Username"}
              {step === 2 && "Payment Email"}
              {step === 3 && "Location"}
              {step === 4 && "Terms of Service"}
              {step === 5 && "All Set!"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Step 1: OSM Username */}
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Enter your OpenStreetMap username. This is used to track your
                  mapping contributions.
                </p>
                <Input
                  value={osmUsername}
                  onChange={(e) => setOsmUsername(e.target.value)}
                  placeholder="Your OSM username"
                />
                <p className="text-sm text-muted-foreground">
                  Don&apos;t have an OSM account?{" "}
                  <a
                    href="https://www.openstreetmap.org/user/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-kaart-orange hover:underline"
                  >
                    Create one here
                  </a>
                </p>
              </div>
            )}

            {/* Step 2: Payment Email */}
            {step === 2 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Enter your Payoneer email address. This is where your payments
                  will be sent.
                </p>
                <Input
                  type="email"
                  value={paymentEmail}
                  onChange={(e) => setPaymentEmail(e.target.value)}
                  placeholder="your-payoneer@email.com"
                />
                <p className="text-sm text-muted-foreground">
                  Don&apos;t have a Payoneer account?{" "}
                  <a
                    href="https://www.payoneer.com/signup/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-kaart-orange hover:underline"
                  >
                    Sign up here
                  </a>
                </p>
              </div>
            )}

            {/* Step 3: Location */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Enter your location. This helps us with regional coordination.
                </p>
                <div className="grid gap-4">
                  <Input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="Country"
                  />
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Terms */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg max-h-48 overflow-y-auto text-sm">
                  <h4 className="font-medium mb-2">Mikro Terms of Service</h4>
                  <p className="mb-2">
                    By using Mikro, you agree to the following terms:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>You will provide accurate mapping data</li>
                    <li>You will follow OSM mapping guidelines</li>
                    <li>
                      You will complete assigned tasks to the best of your
                      ability
                    </li>
                    <li>Payment is subject to validation of your work</li>
                    <li>
                      Fraudulent activity will result in account termination
                    </li>
                    <li>Kaart reserves the right to modify payment rates</li>
                  </ul>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-kaart-orange focus:ring-kaart-orange"
                  />
                  <span>I accept the Terms of Service</span>
                </label>
              </div>
            )}

            {/* Step 5: Complete */}
            {step === 5 && (
              <div className="space-y-4 text-center">
                <div className="text-6xl">🎉</div>
                <p className="text-lg">
                  You&apos;re all set up and ready to start mapping!
                </p>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    <strong>OSM Username:</strong> {osmUsername}
                  </p>
                  {paymentsVisible && (
                    <p>
                      <strong>Payment Email:</strong> {paymentEmail}
                    </p>
                  )}
                  <p>
                    <strong>Location:</strong> {city}, {country}
                  </p>
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-6">
              {step > 1 && step < 5 && (
                <Button variant="outline" onClick={handleBack}>
                  Back
                </Button>
              )}
              {step === 1 && <div />}
              {step < 5 && (
                <Button onClick={handleNext}>
                  {step === 4 ? "Complete Setup" : "Next"}
                </Button>
              )}
              {step === 5 && (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? "Saving..." : "Go to Dashboard"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
