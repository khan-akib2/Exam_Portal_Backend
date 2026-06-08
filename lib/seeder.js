import User from "./models/User.js";
import Question from "./models/Question.js";
import Achievement from "./models/Achievement.js";
import SystemSetting from "./models/SystemSetting.js";
import bcrypt from "bcryptjs";

export async function seedDatabase() {
  // 1. Seed System Settings
  let settings = await SystemSetting.findOne({ key: "global_config" });
  if (!settings) {
    await SystemSetting.create({
      key: "global_config",
      maintenanceMode: false,
      antiCheatEnabled: true,
      xpPerCorrectAnswer: 10,
      xpPerWrongAnswer: 0,
      streakBonusXp: 20,
    });
    console.log("System Settings seeded automatically.");
  }

  // 2. Seed Super Admin
  let superAdmin = await User.findOne({ role: "super_admin" });
  const superAdminEmail = "superadmin@medexam.com";
  const superAdminPass = "Password123!";
  
  if (!superAdmin) {
    const salt = await bcrypt.genSalt(10);
    const hp = await bcrypt.hash(superAdminPass, salt);
    superAdmin = await User.create({
      name: "Super Admin",
      email: superAdminEmail,
      password: hp,
      role: "super_admin",
      status: "active",
    });
    console.log("Super Admin seeded automatically.");
  }

  // 3. Seed Achievements
  const achievementsToSeed = [
    {
      key: "first_exam",
      title: "First Step",
      description: "Completed your first medical examination attempt!",
      icon: "Zap",
      xpBonus: 50,
    },
    {
      key: "perfect_accuracy",
      title: "Surgeon Precision",
      description: "Achieved a perfect 100% accuracy on a full test.",
      icon: "Trophy",
      xpBonus: 100,
    },
    {
      key: "streak_3",
      title: "On Fire",
      description: "Maintained a streak of 3 consecutive passed exams.",
      icon: "Flame",
      xpBonus: 75,
    },
  ];

  for (const ach of achievementsToSeed) {
    await Achievement.findOneAndUpdate(
      { key: ach.key },
      ach,
      { upsert: true, returnDocument: 'after' }
    );
  }

  // 4. Seed Mock Questions (if empty)
  // const qCount = await Question.countDocuments();
  // if (qCount === 0) {
  //   const mockQuestions = [
  //     {
  //       question: "A 45-year-old male presents with severe retrosternal chest pain radiating to the left arm. His ECG shows ST-segment elevation in leads V1 to V4. Which coronary artery is most likely occluded?",
  //       options: [
  //         "Right Coronary Artery (RCA)",
  //         "Left Anterior Descending Artery (LAD)",
  //         "Left Circumflex Artery (LCX)",
  //         "Left Main Coronary Artery"
  //       ],
  //       correctAnswer: 1,
  //       explanation: "ST-elevation in leads V1-V4 indicates an anterior wall myocardial infarction, which is classically caused by occlusion of the Left Anterior Descending (LAD) coronary artery.",
  //       subject: "Cardiology",
  //       difficulty: "Medium"
  //     },
  //     {
  //       question: "Which of the following is the drug of choice for a patient presenting with status epilepticus?",
  //       options: [
  //         "Phenytoin",
  //         "Valproate",
  //         "Lorazepam",
  //         "Carbamazepine"
  //       ],
  //       correctAnswer: 2,
  //       explanation: "Intravenous benzodiazepines, specifically Lorazepam, are the first-line drug of choice for terminating acute status epilepticus due to their rapid onset of action.",
  //       subject: "Pharmacology",
  //       difficulty: "Easy"
  //     },
  //     {
  //       question: "A histopathological slide of a thyroid tumor shows the presence of Orphan Annie eye nuclei and Psammoma bodies. What is the most likely diagnosis?",
  //       options: [
  //         "Follicular Carcinoma",
  //         "Medullary Carcinoma",
  //         "Anaplastic Carcinoma",
  //         "Papillary Thyroid Carcinoma"
  //       ],
  //       correctAnswer: 3,
  //       explanation: "Orphan Annie eye nuclei (cleared, overlapping nuclei) and Psammoma bodies (laminated calcified structures) are pathognomonic diagnostic features of Papillary Thyroid Carcinoma.",
  //       subject: "Pathology",
  //       difficulty: "Hard"
  //     },
  //     {
  //       question: "Which of the following nerves is most commonly injured in a fracture of the midshaft of the humerus?",
  //       options: [
  //         "Axillary nerve",
  //         "Radial nerve",
  //         "Median nerve",
  //         "Ulnar nerve"
  //       ],
  //       correctAnswer: 1,
  //       explanation: "The radial nerve runs in the spiral groove along the posterior midshaft of the humerus, making it the most vulnerable nerve to injury in fractures of this region.",
  //       subject: "Anatomy",
  //       difficulty: "Medium"
  //     },
  //     {
  //       question: "A patient presents with massive splenomegaly, pancytopenia, and dry tap on bone marrow aspiration. The peripheral blood smear shows mononuclear cells with hair-like projections. What is the standard diagnostic marker for this condition?",
  //       options: [
  //         "CD19 and CD20 positive",
  //         "TRAP (Tartrate-Resistant Acid Phosphatase) positive",
  //         "Philadelphia chromosome positive",
  //         "CD15 and CD30 positive"
  //       ],
  //       correctAnswer: 1,
  //       explanation: "The description is characteristic of Hairy Cell Leukemia, which classically stains positive for Tartrate-Resistant Acid Phosphatase (TRAP).",
  //       subject: "Hematology",
  //       difficulty: "Hard"
  //     }
  //   ];
  // 
  //   await Question.insertMany(mockQuestions);
  //   console.log("Mock questions seeded automatically.");
  // }
}
