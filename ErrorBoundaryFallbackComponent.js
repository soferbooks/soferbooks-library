import { useEffect } from 'react';
import { devError } from './devUtils';

// SoferBooks Library sends no crash reports to a third party. The boundary's onError
// (generalAppErrorAlert in index.js) tells the user; this just leaves a trace in the
// device log for debugging.
export const ErrorBoundaryFallbackComponent = ({ error }) => {
  useEffect(() => {
    if (error) { devError('Unhandled error caught by ErrorBoundary:', error); }
  }, [error]);

  return null;
};
