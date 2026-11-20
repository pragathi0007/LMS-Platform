import mongoose from 'mongoose'

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    category: {
      type: String,
      required: true,
      enum: [
        'Programming Languages',
        'Frontend Development',
        'Backend Development',
        'Databases',
        'Frameworks & Libraries',
        'Tools & Technologies',
        'Other Technical Skills',
      ],
      default: 'Other Technical Skills',
    },
    proficiency: {
      type: String,
      required: true,
      enum: ['Beginner', 'Intermediate', 'Advanced'],
      default: 'Intermediate',
    },
  },
  { _id: true },
)

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    technologies: { type: [String], default: [] },
    thumbnailUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    githubUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    liveUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    role: { type: String, trim: true, maxlength: 120, default: '' },
    completionDate: { type: String, trim: true, maxlength: 60, default: '' },
  },
  { _id: true },
)

const experienceSchema = new mongoose.Schema(
  {
    organization: { type: String, required: true, trim: true, maxlength: 140 },
    position: { type: String, required: true, trim: true, maxlength: 120 },
    employmentType: {
      type: String,
      required: true,
      enum: ['Internship', 'Work experience', 'Freelance work', 'Leadership', 'Volunteering', 'Other'],
      default: 'Internship',
    },
    startDate: { type: String, required: true, trim: true, maxlength: 60 },
    endDate: { type: String, trim: true, maxlength: 60, default: '' },
    isCurrent: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { _id: true },
)

const educationSchema = new mongoose.Schema(
  {
    institution: { type: String, required: true, trim: true, maxlength: 160 },
    degree: { type: String, required: true, trim: true, maxlength: 120 },
    fieldOfStudy: { type: String, trim: true, maxlength: 120, default: '' },
    startYear: { type: String, trim: true, maxlength: 20, default: '' },
    endYear: { type: String, trim: true, maxlength: 20, default: '' },
    isCurrent: { type: Boolean, default: false },
    academicDetails: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { _id: true },
)

const externalCertificationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    issuingOrganization: { type: String, required: true, trim: true, maxlength: 140 },
    issueDate: { type: String, trim: true, maxlength: 60, default: '' },
    credentialUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { _id: true },
)

const studentProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    studentType: { type: String, enum: ['independent', 'college'], default: 'independent' },
    headline: { type: String, trim: true, maxlength: 160, default: '' },
    bio: { type: String, trim: true, maxlength: 2000, default: '' },
    location: { type: String, trim: true, maxlength: 120, default: '' },
    phone: { type: String, trim: true, maxlength: 40, default: '' },
    skills: { type: [skillSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    externalCertifications: { type: [externalCertificationSchema], default: [] },
    careerInterests: {
      desiredRole: { type: String, trim: true, maxlength: 120, default: '' },
      interestedTechnologies: { type: [String], default: [] },
      careerGoals: { type: String, trim: true, maxlength: 1000, default: '' },
      preferredIndustry: { type: String, trim: true, maxlength: 120, default: '' },
    },
    socialLinks: {
      linkedin: { type: String, trim: true, maxlength: 1000, default: '' },
      github: { type: String, trim: true, maxlength: 1000, default: '' },
      portfolio: { type: String, trim: true, maxlength: 1000, default: '' },
      other: { type: String, trim: true, maxlength: 1000, default: '' },
    },
  },
  { timestamps: true, collection: 'studentprofiles' },
)

const StudentProfile = mongoose.models.StudentProfile || mongoose.model('StudentProfile', studentProfileSchema)
export default StudentProfile

