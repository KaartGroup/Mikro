"use client";

import { useState, useCallback } from "react";

/**
 * Custom hook for toggle state management.
 * Mimics the existing useToggle hook from the React frontend.
 */
export function useToggle(
  initialValue: boolean = false,
): [boolean, (value?: boolean) => void] {
  const [value, setValue] = useState(initialValue);

  const toggle = useCallback((newValue?: boolean) => {
    if (typeof newValue === "boolean") {
      setValue(newValue);
    } else {
      setValue((prev) => !prev);
    }
  }, []);

  return [value, toggle];
}

export default useToggle;
