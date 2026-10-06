export const isOwner = (email: string | null, owner: string | undefined): boolean =>
  !!email && !!owner && email.toLowerCase() === owner.toLowerCase()
