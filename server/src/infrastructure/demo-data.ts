import type { AlumniStatus, Programme, Role } from '@hilcoe/shared'

// The synthetic demonstration identities and sample content of NFR-9 (used by DemoSeeder).

export interface SeedMember {
  email: string
  displayName: string
  role: Role
  alumniStatus: AlumniStatus | null
  programme: Programme | null
  profile: { bio: string; studyOrExpertise: string; graduationYear?: number; currentPosition?: string }
}

export const ADMINS = [
  { email: 'henok.tsegaye@hilcoeschool.com', isFirstAdmin: true },
  { email: 'marta.kebede@hilcoeschool.com', isFirstAdmin: false },
] as const

export const MEMBERS: SeedMember[] = [
  {
    email: 'selamawit.girma@hilcoeschool.com',
    displayName: 'Selamawit Girma',
    role: 'STUDENT',
    alumniStatus: null,
    programme: 'SOFTWARE_ENGINEERING',
    profile: {
      bio: 'Final-year SE student. Interested in backend systems and payments infrastructure.',
      studyOrExpertise: '4th year, Software Engineering',
      graduationYear: 2027,
    },
  },
  {
    email: 'mahlet.tesfaye@hilcoeschool.com',
    displayName: 'Mahlet Tesfaye',
    role: 'STUDENT',
    alumniStatus: null,
    programme: 'COMPUTER_SCIENCE',
    profile: {
      bio: 'Third-year CS student.',
      studyOrExpertise: '3rd year, Computer Science',
      graduationYear: 2028,
    },
  },
  {
    email: 'abel.tadesse@hilcoeschool.com',
    displayName: 'Abel Tadesse',
    role: 'STUDENT',
    alumniStatus: null,
    programme: 'SOFTWARE_ENGINEERING',
    profile: {
      bio: 'Fourth-year SE student.',
      studyOrExpertise: '4th year, Software Engineering',
      graduationYear: 2027,
    },
  },
  {
    email: 'nahom.getachew@hilcoeschool.com',
    displayName: 'Nahom Getachew',
    role: 'STUDENT',
    alumniStatus: null,
    programme: 'COMPUTER_SCIENCE',
    profile: {
      bio: 'Second-year CS student.',
      studyOrExpertise: '2nd year, Computer Science',
      graduationYear: 2029,
    },
  },
  {
    email: 'meseret.alemayehu@hilcoeschool.com',
    displayName: 'Meseret Alemayehu',
    role: 'STAFF',
    alumniStatus: null,
    programme: null,
    profile: {
      bio: 'I teach Software Design and Architecture and supervise senior projects.',
      studyOrExpertise: 'Lecturer, Software Engineering Department',
    },
  },
  {
    email: 'yonas.bekele@example.com',
    displayName: 'Yonas Bekele',
    role: 'ALUMNI',
    alumniStatus: 'VERIFIED',
    programme: 'COMPUTER_SCIENCE',
    profile: {
      bio: 'HiLCoE 2019. Seven years building payment systems.',
      studyOrExpertise: 'Backend, payments',
      graduationYear: 2019,
      currentPosition: 'Senior Backend Engineer',
    },
  },
  {
    email: 'dawit.mekonnen@example.com',
    displayName: 'Dawit Mekonnen',
    role: 'ALUMNI',
    alumniStatus: 'VERIFIED',
    programme: 'COMPUTER_SCIENCE',
    profile: {
      bio: 'Leading a team of eleven on a billing platform.',
      studyOrExpertise: 'Engineering management',
      graduationYear: 2016,
      currentPosition: 'Engineering Manager',
    },
  },
  {
    email: 'hanan.abdulaziz@example.com',
    displayName: 'Hanan Abdulaziz',
    role: 'ALUMNI',
    alumniStatus: 'SELF_REPORTED',
    programme: 'COMPUTER_SCIENCE',
    profile: {
      bio: 'Graduated 2022. Moved from QA into product analytics.',
      studyOrExpertise: 'Product analytics',
      graduationYear: 2022,
      currentPosition: 'Product Analyst',
    },
  },
]

/** Fixed ids keep the sample content idempotent and let notices point at it. */
export const SEED_ID_KINDS = {
  a: '0000000000',
  b: '0000000001',
  m: '0000000002',
  o: '0000000003',
  g: '0000000004',
  s: '0000000005',
  r: '0000000006',
} as const
export const seedId = (kind: keyof typeof SEED_ID_KINDS, index: number) =>
  `01900000-0000-7000-8000-${SEED_ID_KINDS[kind]}${String(index).padStart(2, '0')}`

export interface SeedPost {
  author: string
  body: string
  tags: string[]
  ageHours: number
  likedBy: string[]
}

export const POSTS: SeedPost[] = [
  {
    author: 'selamawit.girma@hilcoeschool.com',
    body: 'Looking for feedback on my senior project proposal: a ledger service for small merchant payments. Anyone who has worked on reconciliation, I would love an hour of your time.',
    tags: ['senior-project', 'payments'],
    ageHours: 6,
    likedBy: ['mahlet.tesfaye@hilcoeschool.com', 'yonas.bekele@example.com'],
  },
  {
    author: 'yonas.bekele@example.com',
    body: 'Internship season is close. Three things that helped me get my first backend role: ship a small project end to end, write about what you learned, and practise explaining trade-offs out loud.',
    tags: ['career', 'internship'],
    ageHours: 20,
    likedBy: [
      'selamawit.girma@hilcoeschool.com',
      'abel.tadesse@hilcoeschool.com',
      'nahom.getachew@hilcoeschool.com',
      'mahlet.tesfaye@hilcoeschool.com',
    ],
  },
  {
    author: 'meseret.alemayehu@hilcoeschool.com',
    body: 'Reminder for SE 4th year: architecture review drafts are due on Friday. Bring one diagram and a list of open questions.',
    tags: ['software-design'],
    ageHours: 30,
    likedBy: ['abel.tadesse@hilcoeschool.com'],
  },
  {
    author: 'dawit.mekonnen@example.com',
    body: 'Our team is hiring two junior engineers next quarter. I will post the details on the opportunities board when it opens. Meanwhile, happy to answer questions about what the work looks like.',
    tags: ['career', 'hiring'],
    ageHours: 50,
    likedBy: ['selamawit.girma@hilcoeschool.com', 'nahom.getachew@hilcoeschool.com'],
  },
  {
    author: 'mahlet.tesfaye@hilcoeschool.com',
    body: 'Study group for Algorithms this Saturday in the library, 10:00 to 12:00. Everyone welcome.',
    tags: ['study-group', 'algorithms'],
    ageHours: 80,
    likedBy: [],
  },
]

/** Comments by post index; `reply` names the index of a top-level comment on the same post. */
export const COMMENTS: { post: number; author: string; body: string; ageHours: number; reply?: number }[] = [
  {
    post: 0,
    author: 'abel.tadesse@hilcoeschool.com',
    body: 'This sounds great. Are you planning double-entry from the start?',
    ageHours: 2,
  },
  {
    post: 1,
    author: 'selamawit.girma@hilcoeschool.com',
    body: 'How did you practise explaining trade-offs? Mock interviews?',
    ageHours: 12,
  },
  {
    post: 1,
    author: 'dawit.mekonnen@example.com',
    body: 'Mock interviews help, but design reviews with classmates help more. Pick one decision and defend it.',
    ageHours: 1.5,
    reply: 1,
  },
  {
    post: 1,
    author: 'nahom.getachew@hilcoeschool.com',
    body: 'Thank you, the third point is the one I always skip.',
    ageHours: 10,
  },
]

export interface SeedMentor {
  email: string
  available: boolean
  capacity: number
  introduction: string
  topics: string[]
  contacts: { kind: 'EMAIL' | 'TELEGRAM' | 'PHONE' | 'OTHER'; value: string }[]
}

export const MENTORS: SeedMentor[] = [
  {
    email: 'meseret.alemayehu@hilcoeschool.com',
    available: true,
    capacity: 4,
    introduction: 'I teach software design and enjoy helping students shape their senior projects.',
    topics: ['Software design', 'Senior projects'],
    contacts: [{ kind: 'EMAIL', value: 'meseret.alemayehu@hilcoeschool.com' }],
  },
  {
    email: 'yonas.bekele@example.com',
    available: true,
    capacity: 3,
    introduction: 'Backend engineer. Happy to review projects, CVs and interview preparation.',
    topics: ['Backend APIs', 'Career advice', 'Interview preparation'],
    contacts: [
      { kind: 'TELEGRAM', value: '@yonasbekele' },
      { kind: 'EMAIL', value: 'yonas.bekele@example.com' },
    ],
  },
  {
    email: 'dawit.mekonnen@example.com',
    available: true,
    capacity: 2,
    introduction: 'Engineering lead. I mentor on hiring, teamwork and growing into your first role.',
    topics: ['Career advice', 'Team leadership'],
    contacts: [{ kind: 'PHONE', value: '+251 911 000 000' }],
  },
]

/** Selamawit has one active mentorship and one pending request. */
export const MENTORSHIPS = [
  {
    student: 'selamawit.girma@hilcoeschool.com',
    mentor: 'yonas.bekele@example.com',
    topic: 'Backend APIs',
    note: 'I am building a ledger service for my senior project and would value a review of the API design.',
    state: 'ACTIVE' as const,
    ageHours: 72,
    decidedHours: 48,
  },
  {
    student: 'selamawit.girma@hilcoeschool.com',
    mentor: 'meseret.alemayehu@hilcoeschool.com',
    topic: 'Senior projects',
    note: 'Could you help me scope the architecture section of my senior project report?',
    state: 'PENDING' as const,
    ageHours: 4,
    decidedHours: null,
  },
]

export interface SeedOpportunity {
  author: string
  title: string
  organization: string
  location: string
  type: 'INTERNSHIP' | 'PART_TIME' | 'FULL_TIME'
  workArrangement: 'ON_SITE' | 'REMOTE' | 'HYBRID'
  description: string
  applyVia: string
  deadlineDays: number | null
  state: 'OPEN' | 'CLOSED'
  ageHours: number
}

export const OPPORTUNITIES: SeedOpportunity[] = [
  {
    author: 'yonas.bekele@example.com',
    title: 'Backend Engineering Intern',
    organization: 'Chapa Financial Technologies',
    location: 'Addis Ababa',
    type: 'INTERNSHIP',
    workArrangement: 'HYBRID',
    description:
      'Three-month internship on the payments API team. You will write Node.js services, review pull requests and ' +
      'pair with senior engineers. Suits final-year #backend students.',
    applyVia: 'Send your CV and a short note to careers@chapa.example with the subject "Backend intern".',
    deadlineDays: 30,
    state: 'OPEN',
    ageHours: 20,
  },
  {
    author: 'meseret.alemayehu@hilcoeschool.com',
    title: 'Teaching Assistant, Software Design',
    organization: 'HiLCoE School of Computer Science',
    location: 'HiLCoE main campus',
    type: 'PART_TIME',
    workArrangement: 'ON_SITE',
    description:
      'Help run weekly lab sessions for Software Design and Architecture and give feedback on design documents. ' +
      'Six hours a week during the semester.',
    applyVia: 'Visit the Software Engineering Department office before the deadline.',
    deadlineDays: 14,
    state: 'OPEN',
    ageHours: 50,
  },
  {
    author: 'dawit.mekonnen@example.com',
    title: 'Junior QA Engineer',
    organization: 'Gebeya',
    location: 'Remote within Ethiopia',
    type: 'FULL_TIME',
    workArrangement: 'REMOTE',
    description: 'Manual and automated testing for a billing platform.',
    applyVia: 'Apply on the company careers page.',
    deadlineDays: null,
    state: 'CLOSED',
    ageHours: 400,
  },
]

export interface SeedGroup {
  owner: string
  title: string
  description: string
  maxOccupancy: number
  coordinationDetails: string
  state: 'OPEN' | 'CLOSED'
  ageHours: number
  members: { email: string; state: 'ACCEPTED' | 'PENDING'; ageHours: number }[]
}

/** Abel owns an open group with Selamawit as a member and Nahom waiting; a closed one keeps its history. */
export const GROUPS: SeedGroup[] = [
  {
    owner: 'abel.tadesse@hilcoeschool.com',
    title: 'Algorithms study circle',
    description:
      'Weekly #algorithms practice before the exams. Saturdays 10:00 to 12:00. Bring one problem you could not solve.',
    maxOccupancy: 5,
    coordinationDetails: 'Library group room 2. Telegram group: t.me/hilcoe-algorithms-circle',
    state: 'OPEN',
    ageHours: 120,
    members: [
      { email: 'selamawit.girma@hilcoeschool.com', state: 'ACCEPTED', ageHours: 96 },
      { email: 'nahom.getachew@hilcoeschool.com', state: 'PENDING', ageHours: 3 },
    ],
  },
  {
    owner: 'mahlet.tesfaye@hilcoeschool.com',
    title: 'Campus hackathon team',
    description: 'A team for the spring campus hackathon. Thursdays after class.',
    maxOccupancy: 4,
    coordinationDetails: 'Lab 3, after the last lecture on Thursdays.',
    state: 'CLOSED',
    ageHours: 900,
    members: [{ email: 'abel.tadesse@hilcoeschool.com', state: 'ACCEPTED', ageHours: 880 }],
  },
]
