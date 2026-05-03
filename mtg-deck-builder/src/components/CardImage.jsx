import { useState } from 'react'

export default function CardImage({ card, className = '', size = 'normal', showTooltip = false }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const imageUrl = card?.image_uris?.[size]
    || card?.image_uris?.normal
    || card?.card_faces?.[0]?.image_uris?.[size]
    || card?.card_faces?.[0]?.image_uris?.normal

  if (!imageUrl || error) {
    return (
      <div className={`bg-mtg-panel border border-mtg-border rounded-lg flex items-center justify-center ${className}`}>
        <div className="text-center p-2">
          <p className="text-xs text-gray-400 font-medium">{card?.name || 'Unknown'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-mtg-panel border border-mtg-border rounded-lg animate-pulse" />
      )}
      <img
        src={imageUrl}
        alt={card?.name}
        className={`rounded-lg w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        loading="lazy"
      />
    </div>
  )
}
