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
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 
                    import.meta.env.VITE_GOOGLE_API_KEY ||
                    import.meta.env.VITE_MAPS_API_KEY;
      
      if (!apiKey) {
        return;
      }

      if (window.google && window.google.maps) {
        setIsGoogleMapsLoaded(true);
        return;
      }

      if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async&callback=initGoogleMaps`;
        script.async = true;
        script.defer = true;
        
        window.initGoogleMaps = () => {
          setIsGoogleMapsLoaded(true);
          delete window.initGoogleMaps;
        };
        
        script.onerror = () => {
          setIsGoogleMapsLoaded(false);
        };
        
        document.head.appendChild(script);
      }
    };

    loadGoogleMaps();
  }, []);

  // Initialize Google Maps services when API is loaded
  useEffect(() => {
    if (isGoogleMapsLoaded && window.google && window.google.maps) {
      try {
        if (window.google.maps.places.AutocompleteService) {
          autocompleteService.current = new window.google.maps.places.AutocompleteService();
        }

        if (window.google.maps.places.PlacesService) {
          placesService.current = new window.google.maps.places.PlacesService(
            document.createElement('div')
          );
        }
      } catch (error) {
        // Silent fail
      }
    }
  }, [isGoogleMapsLoaded]);

  const searchPlaces = async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);
    
    try {
      // Try new API first
      if (window.google.maps.places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        const request = {
          input: query,
          locationBias: {
            center: { lat: 12.9716, lng: 77.5946 },
            radius: 100000
          },
          includedPrimaryTypes: ['establishment', 'geocode']
        };
        
        const { suggestions: newSuggestions } = await window.google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        
        if (newSuggestions && newSuggestions.length > 0) {
          const formattedSuggestions = newSuggestions.slice(0, 5).map((suggestion: any) => ({
            place_id: suggestion.place.id,
            description: suggestion.place.displayName || suggestion.place.formattedAddress,
          }));
          
          setSuggestions(formattedSuggestions);
          setShowSuggestions(true);
          setIsLoading(false);
          return;
        }
      }
    } catch (error) {
      // Fall through to legacy API
    }

    // Fallback to legacy API
    if (autocompleteService.current) {
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
    } else {
      setIsLoading(false);
    }
  };

  const getPlaceDetails = async (placeId: string, description: string) => {
    try {
      // Try new API first
      if (window.google.maps.places.Place?.fetchFields) {
        const { place } = await window.google.maps.places.Place.fetchFields({
          id: placeId,
          fields: ['displayName', 'formattedAddress', 'location'],
        });
        
        const lat = place.location.lat();
        const lng = place.location.lng();
        const address = place.formattedAddress || place.displayName || description;
        
        onChange(address);
        onLocationSelect?.({ lat, lng, address });
        setShowSuggestions(false);
        return;
      }
    } catch (error) {
      // Fall through to legacy API
    }

    // Fallback to legacy API
    if (placesService.current) {
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
    }
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