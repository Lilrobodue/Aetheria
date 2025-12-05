import React, { useState, useEffect } from 'react';

interface OfflineIndicatorProps {
  showWhenOnline?: boolean;
  className?: string;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ 
  showWhenOnline = false, 
  className = '' 
}) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showIndicator, setShowIndicator] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (showWhenOnline) {
        setShowIndicator(true);
        // Hide the online indicator after 3 seconds
        setTimeout(() => setShowIndicator(false), 3000);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowIndicator(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial state
    if (!isOnline) {
      setShowIndicator(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showWhenOnline]);

  // Don't show anything if online and showWhenOnline is false
  if (isOnline && !showWhenOnline && !showIndicator) {
    return null;
  }

  // Don't show anything if we're not supposed to show the indicator
  if (!showIndicator) {
    return null;
  }

  return (
    <div
      className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg transition-all duration-300 ${
        isOnline 
          ? 'bg-green-600 text-white' 
          : 'bg-orange-600 text-white'
      } ${className}`}
    >
      <div className="flex items-center gap-2">
        {isOnline ? (
          <>
            <div className="w-2 h-2 bg-green-300 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Back Online</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 bg-orange-300 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">Offline Mode</span>
          </>
        )}
      </div>
      {!isOnline && (
        <p className="text-xs mt-1 opacity-90">
          App cached for offline use
        </p>
      )}
    </div>
  );
};

export default OfflineIndicator;