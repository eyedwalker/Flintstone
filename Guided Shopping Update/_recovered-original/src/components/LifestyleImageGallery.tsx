import { useState } from 'react';
import { Download, Filter, X, ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';

interface LifestyleImage {
  id: string;
  title: string;
  category: string;
  treatment: string;
  beforeUrl: string;
  afterUrl: string;
  description: string;
}

export function LifestyleImageGallery() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedImage, setSelectedImage] = useState<LifestyleImage | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const categories = [
    { id: 'all', name: 'All Activities', count: 12 },
    { id: 'sports', name: 'Sports & Fitness', count: 3 },
    { id: 'outdoor', name: 'Outdoor Adventures', count: 3 },
    { id: 'work', name: 'Work & Office', count: 3 },
    { id: 'lifestyle', name: 'Daily Life', count: 3 }
  ];

  const images: LifestyleImage[] = [
    {
      id: '1',
      title: 'Tennis Match',
      category: 'sports',
      treatment: 'Polarized',
      beforeUrl: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=800&h=600&fit=crop&sat=1.2&con=1.15',
      description: 'Polarized lenses reduce glare from court surfaces, improving ball tracking and reaction time.'
    },
    {
      id: '2',
      title: 'Mountain Biking',
      category: 'sports',
      treatment: 'Photochromic',
      beforeUrl: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=800&h=600&fit=crop&sat=1.15&con=1.1',
      description: 'Photochromic lenses adapt to changing light conditions on trails, from shaded woods to bright clearings.'
    },
    {
      id: '3',
      title: 'Running Track',
      category: 'sports',
      treatment: 'UV Protection',
      beforeUrl: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800&h=600&fit=crop&con=1.1',
      description: 'UV protection shields your eyes during outdoor training while maintaining visual clarity.'
    },
    {
      id: '4',
      title: 'Beach Sunset',
      category: 'outdoor',
      treatment: 'Polarized',
      beforeUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop&sat=1.25&con=1.15',
      description: 'Eliminate water glare and see beneath the surface with polarized lenses at the beach.'
    },
    {
      id: '5',
      title: 'Hiking Trail',
      category: 'outdoor',
      treatment: 'Photochromic',
      beforeUrl: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&h=600&fit=crop&bri=0.9&con=1.15',
      description: 'Lenses that automatically adjust as you move between shaded forests and sunny peaks.'
    },
    {
      id: '6',
      title: 'Fishing',
      category: 'outdoor',
      treatment: 'Polarized',
      beforeUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop&sat=1.2&con=1.2',
      description: 'See through water surface reflections to spot fish and underwater structures more clearly.'
    },
    {
      id: '7',
      title: 'Computer Work',
      category: 'work',
      treatment: 'Blue Light Filter',
      beforeUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop&sepia=0.15',
      description: 'Blue light filtering reduces digital eye strain during extended screen time.'
    },
    {
      id: '8',
      title: 'Office Meeting',
      category: 'work',
      treatment: 'Anti-Reflective',
      beforeUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop&con=1.1',
      description: 'Anti-reflective coating reduces glare from overhead lighting and screens in office environments.'
    },
    {
      id: '9',
      title: 'Reading Documents',
      category: 'work',
      treatment: 'Progressive Lenses',
      beforeUrl: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop&con=1.05',
      description: 'Seamless vision at all distances - from computer screen to documents to across the room.'
    },
    {
      id: '10',
      title: 'Driving',
      category: 'lifestyle',
      treatment: 'Polarized',
      beforeUrl: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&h=600&fit=crop&con=1.15',
      description: 'Reduce glare from windshields, road surfaces, and other vehicles for safer driving.'
    },
    {
      id: '11',
      title: 'Reading Outdoors',
      category: 'lifestyle',
      treatment: 'Photochromic',
      beforeUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&h=600&fit=crop&bri=0.95',
      description: 'Lenses darken outdoors for sun protection, lighten indoors for comfortable reading.'
    },
    {
      id: '12',
      title: 'Evening Activities',
      category: 'lifestyle',
      treatment: 'Night Driving',
      beforeUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop',
      afterUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop&con=1.1&bri=1.05',
      description: 'Enhanced contrast and reduced glare from headlights for safer nighttime driving.'
    }
  ];

  const filteredImages = selectedCategory === 'all' 
    ? images 
    : images.filter(img => img.category === selectedCategory);

  const handleDownload = (imageUrl: string, title: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.jpg`;
    link.click();
  };

  const openImageModal = (image: LifestyleImage) => {
    setSelectedImage(image);
    setShowComparison(false);
    setCurrentImageIndex(filteredImages.findIndex(img => img.id === image.id));
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' 
      ? (currentImageIndex - 1 + filteredImages.length) % filteredImages.length
      : (currentImageIndex + 1) % filteredImages.length;
    
    setCurrentImageIndex(newIndex);
    setSelectedImage(filteredImages[newIndex]);
    setShowComparison(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Lifestyle Image Gallery</h1>
          <p className="text-gray-600">Browse curated photos showing lens benefits in various activities</p>
        </div>

        {/* Category Filter */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-5 h-5 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Filter by activity:</span>
            <div className="flex gap-2 flex-wrap">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedCategory === category.id
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {category.name} ({category.count})
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Image Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12">
          {filteredImages.map((image) => (
            <button
              key={image.id}
              onClick={() => openImageModal(image)}
              className="group bg-white rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all transform hover:-translate-y-1"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={image.afterUrl}
                  alt={image.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-center gap-2 text-white">
                      <ZoomIn className="w-4 h-4" />
                      <span className="text-sm font-medium">View Details</span>
                    </div>
                  </div>
                </div>
                <div className="absolute top-2 right-2 bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                  {image.treatment}
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-1">{image.title}</h3>
                <p className="text-xs text-gray-600 line-clamp-2">{image.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Info Section */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg shadow-lg p-6 text-white">
            <h3 className="text-lg font-bold mb-3">Professional Photography</h3>
            <p className="text-sm text-blue-100">
              High-quality images demonstrating real-world lens benefits across diverse activities and lighting conditions.
            </p>
          </div>
          <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-lg shadow-lg p-6 text-white">
            <h3 className="text-lg font-bold mb-3">Before & After</h3>
            <p className="text-sm text-green-100">
              Click any image to see side-by-side comparisons showing the difference lens treatments make.
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg shadow-lg p-6 text-white">
            <h3 className="text-lg font-bold mb-3">Download & Share</h3>
            <p className="text-sm text-purple-100">
              Save high-resolution images to show friends and family or keep for your own reference.
            </p>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {selectedImage && (
        <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-6xl w-full">
            {/* Close Button */}
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 p-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full text-white transition-colors z-10"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Navigation */}
            <button
              onClick={() => navigateImage('prev')}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full text-white transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateImage('next')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full text-white transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Image Content */}
            <div className="bg-white rounded-lg overflow-hidden">
              <div className="grid md:grid-cols-2">
                {/* Before/After Images */}
                <div className="relative aspect-[4/3]">
                  <img
                    src={showComparison ? selectedImage.beforeUrl : selectedImage.afterUrl}
                    alt={showComparison ? 'Without treatment' : 'With treatment'}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-black bg-opacity-70 text-white px-3 py-1 rounded text-sm font-medium">
                    {showComparison ? 'Without Treatment' : `With ${selectedImage.treatment}`}
                  </div>
                </div>

                {/* Info Panel */}
                <div className="p-6 flex flex-col">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedImage.title}</h2>
                  <div className="mb-4">
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                      {selectedImage.treatment}
                    </span>
                  </div>
                  
                  <p className="text-gray-700 mb-6 flex-1">{selectedImage.description}</p>

                  <div className="space-y-3">
                    <button
                      onClick={() => setShowComparison(!showComparison)}
                      className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <Filter className="w-5 h-5" />
                      {showComparison ? 'Show With Treatment' : 'Show Without Treatment'}
                    </button>
                    
                    <button
                      onClick={() => handleDownload(selectedImage.afterUrl, selectedImage.title)}
                      className="w-full px-6 py-3 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <Download className="w-5 h-5" />
                      Download Image
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
