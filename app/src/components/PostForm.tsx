import { useState, FormEvent } from 'react'

interface PostFormProps {
  onSubmit: (content: string) => Promise<boolean>
  isLoading?: boolean
}

export default function PostForm({ onSubmit, isLoading }: PostFormProps) {
  const [content, setContent] = useState('')
  const MAX = 2000

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    const ok = await onSubmit(content)
    if (ok) setContent('')
  }

  return (
    <form onSubmit={handleSubmit} className="post-form">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="今何してる？ (koshi)"
        maxLength={MAX}
        rows={3}
      />
      <div className="post-form-footer">
        <span className={`char-count ${content.length > MAX * 0.9 ? 'warn' : ''}`}>
          {content.length} / {MAX}
        </span>
        <button type="submit" disabled={isLoading || !content.trim()} className="btn-primary">
          {isLoading ? '投稿中...' : '投稿'}
        </button>
      </div>
    </form>
  )
}
