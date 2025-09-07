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
        console.error('Google Maps API key not found');
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
        
        script.onerror = (error) => {
          console.error('Failed to load Google Maps API:', error);
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
        console.error('Error initializing Google Maps services:', error);
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
      // Use the correct JavaScript Maps API AutocompleteService
      if (autocompleteService.current) {
        const request = {
          input: query,
          location: new window.google.maps.LatLng(12.9716, 77.5946), // Bengaluru
          radius: 100000,
          types: ['establishment', 'geocode']
        };
        
        autocompleteService.current.getPlacePredictions(request, (predictions: any[], status: any) => {
          setIsLoading(false);
          
          if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
            const formattedSuggestions = predictions.slice(0, 5).map((prediction: any) => ({
              place_id: prediction.place_id,
              description: prediction.description,
              structured_formatting: prediction.structured_formatting
            }));
            
            setSuggestions(formattedSuggestions);
            setShowSuggestions(true);
          } else {
            console.log('Places API status:', status);
            setSuggestions([]);
            setShowSuggestions(false);
          }
        });
      } else {
        console.error('AutocompleteService not initialized');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Error fetching places:', error);
      setIsLoading(false);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const getPlaceDetails = async (placeId: string, description: string) => {
    try {
      if (placesService.current) {
        placesService.current.getDetails(
          {
            placeId: placeId,
            fields: ['geometry', 'formatted_address', 'name']
          },
          (place: any, status: string) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
              const lat = place.geometry.location.lat();
              const lng = place.geometry.location.lng();
              const address = place.formatted_address || place.name || description;
              
              onChange(address);
              onLocationSelect?.({ lat, lng, address });
              setShowSuggestions(false);
            } else {
              console.error('Place details error:', status);
              // Fallback to just using the description
              onChange(description);
              setShowSuggestions(false);
            }
          }
        );
      } else {
        // Fallback if places service is not available
        onChange(description);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error('Error getting place details:', error);
      // Fallback to just using the description
      onChange(description);
      setShowSuggestions(false);
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