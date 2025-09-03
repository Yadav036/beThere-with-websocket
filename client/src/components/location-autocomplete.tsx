import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';

interface LocationSuggestion {
  place_id: string;
  description: string;
  lat?: number;
  lng?: number;
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onLocationSelect?: (location: { lat: number; lng: number; address: string }) => void;
  placeholder?: string;
  disabled?: boolean;
}

declare global {
  interface Window {
    google: any;
    initGoogleMaps: () => void;
  }
}

export function LocationAutocomplete({ 
  value, 
  onChange, 
  onLocationSelect, 
  placeholder = "Search for a location...",
  disabled = false 
}: LocationAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteService = useRef<any>(null);
  const placesService = useRef<any>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);

  // Load Google Maps API
  useEffect(() => {
    const loadGoogleMaps = () => {
      if (window.google && window.google.maps) {
        setIsGoogleMapsLoaded(true);
        return;
      }

      // Add the script if it doesn't exist
      if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&callback=initGoogleMaps`;
        script.async = true;
        script.defer = true;
        
        window.initGoogleMaps = () => {
          setIsGoogleMapsLoaded(true);
        };
        
        document.head.appendChild(script);
      }
    };

    loadGoogleMaps();
  }, []);

  // Initialize Google Maps services when API is loaded
  useEffect(() => {
    if (isGoogleMapsLoaded && window.google && window.google.maps) {
      autocompleteService.current = new window.google.maps.places.AutocompleteService();
      placesService.current = new window.google.maps.places.PlacesService(
        document.createElement('div')
      );
    }
  }, [isGoogleMapsLoaded]);

  const searchPlaces = async (query: string) => {
    if (!autocompleteService.current || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);
    
    autocompleteService.current.getPlacePredictions(
      {
        input: query,
        types: ['establishment', 'geocode'],
      },
      (predictions: any[], status: string) => {
        setIsLoading(false);
        
        if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
          const formattedSuggestions = predictions.slice(0, 5).map(prediction => ({
            place_id: prediction.place_id,
            description: prediction.description,
          }));
          setSuggestions(formattedSuggestions);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }
    );
  };

  const getPlaceDetails = (placeId: string, description: string) => {
    if (!placesService.current) return;

    placesService.current.getDetails(
      {
        placeId: placeId,
        fields: ['geometry', 'formatted_address']
      },
      (place: any, status: string) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const address = place.formatted_address || description;
          
          onChange(address);
          onLocationSelect?.({ lat, lng, address });
          setShowSuggestions(false);
        }
      }
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);
    
    if (inputValue.length >= 2) {
      searchPlaces(inputValue);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion: LocationSuggestion) => {
    getPlaceDetails(suggestion.place_id, suggestion.description);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleBlur = () => {
    // Delay hiding suggestions to allow for clicking
    setTimeout(() => setShowSuggestions(false), 200);
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => value.length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
        placeholder={placeholder}
        disabled={disabled || !isGoogleMapsLoaded}
        className="w-full retro-border font-semibold"
        data-testid="input-location"
      />
      
      {!isGoogleMapsLoaded && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-muted-foreground">
          Loading maps...
        </div>
      )}
      
      {isLoading && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm text-muted-foreground">
          Searching...
        </div>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white retro-border border-4 border-black shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.place_id}
              className="px-4 py-3 cursor-pointer hover:bg-yellow-100 border-b-2 border-black font-bold text-sm"
              onClick={() => handleSuggestionClick(suggestion)}
              data-testid={`suggestion-${suggestion.place_id}`}
            >
              📍 {suggestion.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}