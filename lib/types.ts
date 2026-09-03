export type Person = {
  id: string;
  displayName: string;
  gender?: "male" | "female" | null;
  givenName: string | null;
  familyName: string | null;
  maidenName: string | null;
  birthDate: string | null;
  deathDate: string | null;
  birthPlace: string | null;
  deathPlace: string | null;
  birthCity: string | null;
  birthCountry: string | null;
  deathCity: string | null;
  deathCountry: string | null;
  /** where the person is buried - a cemetery or plot, not a city */
  burialPlace: string | null;
  /** where they live, or last lived - a city or country, not an address */
  residence: string | null;
  biography: string | null;
  /** every photograph linked to this person, portrait first */
  photoIds?: string[];
  photoAttachmentId: string | null;
};

export type Relationship = {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: "parent" | "spouse";
  /** spouse links only: null means married; "divorced" | "widowed" otherwise */
  status?: string | null;
};

export type Story = {
  id: string;
  title: string;
  body: string;
  /** the archive's own words, when the body above is a translation of them */
  originalBody?: string | null;
  date: string | null;
  place: string | null;
  personIds: string[];
  attachmentIds?: string[];
};

/** A question the record cannot answer alone, queued in the Fill-in tab for
 * the family to confirm or deny. Confirming applies the prepared change. */
export type OpenQuestion = {
  id: string;
  question: string;
  evidence: string | null;
  actionSummary: string | null;
  /** confirm needs the reviewer to supply a name (e.g. an unnamed spouse) */
  needsAnswerText: boolean;
  /** the answers worth offering as buttons - a yes/no question should be
   * answered by pressing Yes, not by typing */
  choices?: { label: string; verdict: "confirm" | "deny" }[];
  /** a photograph the question is about, shown with it */
  imageId?: string | null;
  status: "open" | "confirmed" | "denied";
  createdAt: string;
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
};

export type EvidenceClaim = {
  id: string;
  subjectType: "person" | "relationship";
  subjectId: string;
  predicate: string;
  value: string | null;
  status: "preferred" | "disputed" | "rejected";
  confidence: number;
  sourceType: "manual" | "family_assertion" | "attachment" | "agent" | "import";
  attachmentId: string | null;
  sourceLabel: string;
  sourceLocator: string | null;
  sourceExcerpt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FamilyTree = {
  people: Person[];
  relationships: Relationship[];
  stories: Story[];
  /** The person the tree opens on for a viewer who has not identified
   * themselves - a per-archive setting, not a hardcoded name. */
  rootPersonId?: string | null;
};

export type AddPersonProposal = {
  kind: "add_person";
  summary: string;
  person: Omit<Person, "id">;
  relationshipHints?: Array<{ personName: string; relationshipType: "parent" | "spouse" }>;
};

export type UpdatePersonProposal = {
  kind: "update_person";
  summary: string;
  personId: string;
  patch: Omit<Person, "id">;
};

export type AddRelationshipProposal = {
  kind: "add_relationship";
  summary: string;
  fromPersonId: string;
  toPersonId: string;
  fromPersonName?: string | null;
  toPersonName?: string | null;
  relationshipType: "parent" | "spouse";
};

export type DeletePersonProposal = {
  kind: "delete_person";
  summary: string;
  personId: string;
};

export type DeleteRelationshipProposal = {
  kind: "delete_relationship";
  summary: string;
  relationshipId: string;
};

export type MergePeopleProposal = {
  kind: "merge_people";
  summary: string;
  /** duplicate record whose useful data and links move into the target */
  sourcePersonId: string;
  /** canonical record that survives */
  targetPersonId: string;
};

export type AddStoryProposal = {
  kind: "add_story";
  summary: string;
  title: string;
  body: string;
  date: string | null;
  place: string | null;
  personIds: string[];
  attachmentIds: string[];
};

export type UpdateStoryProposal = {
  kind: "update_story";
  summary: string;
  storyId: string;
  title: string;
  body: string;
  date: string | null;
  place: string | null;
  personIds: string[];
  attachmentIds: string[];
};

export type DeleteStoryProposal = {
  kind: "delete_story";
  summary: string;
  storyId: string;
};

export type DeleteAttachmentProposal = {
  kind: "delete_attachment";
  summary: string;
  attachmentId: string;
};

export type AgentConflict = {
  question: string;
  reason: string;
  candidatePersonIds: string[];
  evidence: string[];
};

export type ChangeProposal =
  | AddPersonProposal
  | UpdatePersonProposal
  | DeletePersonProposal
  | AddRelationshipProposal
  | DeleteRelationshipProposal
  | MergePeopleProposal
  | AddStoryProposal
  | UpdateStoryProposal
  | DeleteStoryProposal
  | DeleteAttachmentProposal;
