import mongoose from 'mongoose'

const certificateTemplateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    activeTemplateId: { type: String, trim: true },
    imageData: { type: Buffer, select: false },
    secureUrl: { type: String, trim: true },
    publicId: { type: String, trim: true },
    contentType: { type: String, enum: ['image/png', 'image/jpeg'] },
    fileName: { type: String, trim: true, maxlength: 180 },
    fileSize: { type: Number, min: 1, max: 4 * 1024 * 1024 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { autoCreate: false, autoIndex: false, timestamps: true, collection: 'certificate_templates' },
)

const CertificateTemplate = mongoose.models.CertificateTemplate
  || mongoose.model('CertificateTemplate', certificateTemplateSchema, 'certificate_templates')

export default CertificateTemplate
