export interface SearchData {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  stops?: string;
}

const STOPS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '0', label: 'Direct' },
  { value: '1', label: '1 stop' },
  { value: '2+', label: '2+ stops' },
];

export const SearchForm: React.FC<SearchFormProps> = ({ onSearch, isLoading }) => {
  const [formData, setFormData] = useState<SearchData>({
    origin: '',
    destination: '',
    date: '',
    adults: 1,
    stops: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(formData);
  };

  const handleInputChange = (field: keyof SearchData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };
} 