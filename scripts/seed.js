'use strict';

const bcrypt = require('bcrypt');
const { pool } = require('../config/database');

const BCRYPT_ROUNDS = 12;

const teacherSeed = [
    ['teacher-data', 'Lena Carter', 'lena.carter@mindbloom.test', 'Passionate about turning complex data into meaningful insights using Python, pandas, and SQL.', 'teacher123', 'Data Science'],
    ['teacher-ml', 'Marcus Lee', 'marcus.lee@mindbloom.test', 'Experienced ML developer focused on building predictive models using scikit-learn and TensorFlow.', 'teacher123', 'Machine Learning'],
    ['teacher-ai', 'Priya Shah', 'priya.shah@mindbloom.test', 'AI educator specializing in neural networks, NLP, and ethical AI development.', 'teacher123', 'Artificial Intelligence'],
    ['teacher-web', 'Ava Patel', 'ava.patel@mindbloom.test', 'Full-stack web developer teaching MERN stack, RESTful APIs, and frontend frameworks.', 'teacher123', 'Web Development'],
    ['teacher-blockchain', 'Noah Kim', 'noah.kim@mindbloom.test', 'Blockchain developer passionate about smart contracts, Ethereum, and DApps.', 'teacher123', 'Blockchain'],
    ['teacher-security', 'Maya Brooks', 'maya.brooks@mindbloom.test', 'Security analyst skilled in ethical hacking and system hardening.', 'teacher123', 'Cybersecurity'],
    ['teacher-cloud', 'Ethan Ross', 'ethan.ross@mindbloom.test', 'Cloud architect with deep knowledge of AWS and GCP.', 'teacher123', 'Cloud Computing'],
    ['teacher-devops', 'Sophia Nguyen', 'sophia.nguyen@mindbloom.test', 'DevOps engineer focused on CI/CD pipelines, Docker, and Kubernetes.', 'teacher123', 'DevOps'],
    ['teacher-mobile', 'Daniel Wright', 'daniel.wright@mindbloom.test', 'App developer skilled in Flutter and Android development.', 'teacher123', 'Mobile App Development'],
    ['teacher-db', 'Olivia Chen', 'olivia.chen@mindbloom.test', 'Database expert experienced with MySQL, PostgreSQL, and MongoDB.', 'teacher123', 'Database Systems'],
    ['teacher-design', 'Harper Wilson', 'harper.wilson@mindbloom.test', 'Creative UI/UX designer helping students build intuitive digital products.', 'teacher123', 'UI/UX Design'],
    ['teacher-se', 'Jack Turner', 'jack.turner@mindbloom.test', 'Software engineer with a focus on system design, OOP, and agile methodologies.', 'teacher123', 'Software Engineering'],
    ['teacher-bigdata', 'Zoe Martin', 'zoe.martin@mindbloom.test', 'Big data specialist working with Hadoop, Spark, and distributed systems.', 'teacher123', 'Big Data'],
    ['teacher-nlp', 'Henry Adams', 'henry.adams@mindbloom.test', 'NLP researcher focused on chatbots, sentiment analysis, and LLMs.', 'teacher123', 'NLP (Natural Language Processing)'],
    ['teacher-game', 'Chloe Baker', 'chloe.baker@mindbloom.test', 'Game developer with expertise in Unity and C#.', 'teacher123', 'Game Development'],
    ['teacher-cv', 'Leo Scott', 'leo.scott@mindbloom.test', 'Computer vision engineer working on facial recognition and object detection.', 'teacher123', 'Computer Vision'],
    ['teacher-iot', 'Ella Davis', 'ella.davis@mindbloom.test', 'IoT innovator building smart devices and teaching embedded systems.', 'teacher123', 'Internet of Things (IoT)'],
    ['teacher-robotics', 'Owen Clark', 'owen.clark@mindbloom.test', 'Robotics engineer passionate about automation and microcontrollers.', 'teacher123', 'Robotics'],
    ['teacher-quantum', 'Grace Hall', 'grace.hall@mindbloom.test', 'Quantum computing researcher exploring Qiskit and quantum algorithms.', 'teacher123', 'Quantum Computing'],
    ['teacher-arvr', 'Nina Perez', 'nina.perez@mindbloom.test', 'AR/VR creator focused on immersive environments using Unity and Unreal Engine.', 'teacher123', 'Augmented & Virtual Reality']
];

const courseSeed = [
    ['course-data-science', 'Introduction to Data Science', 'Learn how to analyze data, visualize patterns, and make predictions using Python and Pandas.', 12, 'teacher-data', 'https://www.fsm.ac.in/blog/wp-content/uploads/2022/07/FUqHEVVUsAAbZB0-1024x580.jpg', 'https://youtu.be/ua-CiDNNj30'],
    ['course-machine-learning', 'Machine Learning A-Z', 'From linear regression to deep learning, get hands-on with real ML projects.', 25, 'teacher-ml', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRWBYtT0HRhb5qKGRzNSL5Bxzt0BEuEBlNYUw&s', 'https://youtu.be/_8QQsloyheY'],
    ['course-web-mern', 'Web Development with MERN', 'Build full-stack web apps using MongoDB, Express, React, and Node.js.', 30, 'teacher-web', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOAtzhPhuuHGBFDyiKn4HoT48XHvtgEUK4Lg&s', 'https://youtu.be/Vi9bxu-M-ag'],
    ['course-blockchain', 'Fundamentals of Blockchain', 'Understand how blockchain works, Ethereum, smart contracts, and DApps.', 15, 'teacher-blockchain', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTg3w-9y6xj2yRK1uGxiDQc2nVNaX8hk55R0g&s', 'https://www.youtube.com/live/3fUZENyWpB0'],
    ['course-cybersecurity', 'Cybersecurity Essentials', 'Protect digital systems and learn ethical hacking, firewalls, and threat analysis.', 20, 'teacher-security', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX9GCZv2yTguUOpseXmjD3Ap-gD3iZcaYXnQ&s', 'https://www.youtube.com/live/1EVjVXLD5eM'],
    ['course-cloud', 'Cloud Computing with AWS', 'Master AWS services like EC2, S3, Lambda, and deploy scalable applications.', 18, 'teacher-cloud', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR12nPY60wXMYF9CwroNFdR7NyWvlXeBYFZMA&s', 'https://www.youtube.com/live/yAPckJzaG7Y'],
    ['course-devops', 'DevOps for Beginners', 'Get started with CI/CD pipelines, Docker, Kubernetes, and infrastructure as code.', 22, 'teacher-devops', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRpV4jTz04zYYmoYct0Y9sYoiPP9_U52RSk0w&s', 'https://youtu.be/hQcFE0RD0cQ'],
    ['course-mobile', 'Mobile App Development with Flutter', 'Create beautiful cross-platform apps using Flutter and Dart.', 16, 'teacher-mobile', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRLXxnxUe7IfBCS8FVMQLCGk3S2LtwaXjVblQ&s', 'https://youtu.be/8sAyPDLorek'],
    ['course-database', 'Database Design & Management', 'Learn to model, design, and manage SQL and NoSQL databases effectively.', 14, 'teacher-db', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRyfqUpnNf_dvnLsshajIVmUwGjU5WZYPScZg&s', 'https://youtu.be/6V4miYuD4lA'],
    ['course-uiux', 'UI/UX Design Principles', 'Design user-centric interfaces using Figma, wireframes, and usability testing.', 10, 'teacher-design', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQtf-WvRhy6SDyOYGkh7EFXMqwhrKLPjGyfHg&s', 'https://youtu.be/9UpJTsMQ68Y'],
    ['course-software-engineering', 'Software Engineering Fundamentals', 'Understand software life cycles, OOP, testing, and agile development.', 20, 'teacher-se', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRfe_rBZ-p6URS5Qa2_5wACIGuK969kzBDJ5Q&s', 'https://youtu.be/sB2iQSvrcG0'],
    ['course-big-data', 'Big Data Analytics', 'Work with Hadoop, Spark, and real-time analytics pipelines.', 17, 'teacher-bigdata', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTw4B68CtfKGtFwbxNDHtJFexCRQyu_I1fkIw&s', 'https://www.youtube.com/live/yTq2qc_eaTk'],
    ['course-nlp', 'Natural Language Processing', 'Explore sentiment analysis, chatbots, and text classification using NLP.', 13, 'teacher-nlp', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQon17tf5OsgYvFOwytREJ58wc-h0xvTmlT3A&s', 'https://youtu.be/ENLEjGozrio'],
    ['course-game', 'Game Development with Unity', 'Build engaging 2D and 3D games with Unity and C# scripting.', 21, 'teacher-game', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTNBBeum3Dj1JrnEgXAXFBLg583MVIqyX5WSg&s', 'https://youtu.be/gB1F9G0JXOo'],
    ['course-computer-vision', 'Computer Vision Basics', 'Learn object detection, image processing, and OpenCV tools.', 19, 'teacher-cv', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQD0-3ngS5YxzOvqsQR49sUy8_iEvFvlM-J1g&s', 'https://youtu.be/qT28sMnX2F4'],
    ['course-iot', 'IoT and Embedded Systems', 'Build smart devices and learn how IoT works using sensors and microcontrollers.', 11, 'teacher-iot', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRUcWx3POUIbi7JciXRSiu7FHG1NVauOWpMwA&s', 'https://www.youtube.com/live/mKOzmwAD5mQ'],
    ['course-robotics', 'Robotics with Arduino', 'Control motors, sensors, and build robots using Arduino boards.', 13, 'teacher-robotics', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR7D5Ii8AgDUjO2rTrhCl6gZr8RmmZfr_op2w&s', 'https://youtu.be/BjzaKMvR8s0'],
    ['course-quantum', 'Quantum Computing Basics', 'Dive into Qiskit, quantum gates, and fundamental quantum algorithms.', 9, 'teacher-quantum', 'https://cdn.publish0x.com/prod/fs/images/3c623ecf13c7e64f53b56ff1bafdf115e9453842b952fec9d42507e19260309e.png', 'https://example.com/videos/quantum'],
    ['course-arvr', 'Augmented Reality Development', 'Create immersive AR experiences with Unity and ARCore/ARKit.', 14, 'teacher-arvr', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRAJOirgW3JElCmvdDprRMRz86d1dPZJ_woLw&s', 'https://youtu.be/WzfDo2Wpxks'],
    ['course-full-stack', 'Full Stack JavaScript Bootcamp', 'Become a full stack developer with JavaScript, Node.js, and frontend frameworks.', 28, 'teacher-web', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQj04F5QC-2S6nLmbf32H6eIg3lWIqm4IuMWA&s', 'https://youtu.be/zJSY8tbf_ys']
];

const userSeed = [
    ['user-student', 'Daniel Kim', 'daniel@mindbloom.test', 'student123', 'https://i.pravatar.cc/300?img=12']
];

const adminSeed = [
    [1, 'admin', 'admin123']
];

const enrollmentSeed = [
    ['enroll-1', 'user-student', 'course-web-mern']
];

async function runSeed() {
    const teacherSeedRows = await Promise.all(
        teacherSeed.map(async (row) => [
            row[0], row[1], row[2], row[3],
            await bcrypt.hash(row[4], BCRYPT_ROUNDS),
            row[5]
        ])
    );

    const userSeedRows = await Promise.all(
        userSeed.map(async (row) => [
            row[0], row[1], row[2],
            await bcrypt.hash(row[3], BCRYPT_ROUNDS),
            row[4]
        ])
    );

    const adminSeedRows = await Promise.all(
        adminSeed.map(async (row) => [
            row[0], row[1],
            await bcrypt.hash(row[2], BCRYPT_ROUNDS)
        ])
    );

    for (const row of teacherSeedRows) {
        await pool.query(
            'INSERT INTO teachers (TID, TNAME, EMAIL, BIO, PASS, SPECIAL) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (TID) DO NOTHING',
            row
        );
    }

    for (const row of courseSeed) {
        await pool.query(
            'INSERT INTO courses (CID, TITLE, DESCRIP, VIDEO, TID, IMGLINK, VIDLINK) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (CID) DO NOTHING',
            row
        );
    }

    for (const row of userSeedRows) {
        await pool.query(
            'INSERT INTO users (USERID, UNAME, EMAIL, PSWD, IMG) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (USERID) DO NOTHING',
            row
        );
    }

    for (const row of adminSeedRows) {
        await pool.query(
            'INSERT INTO admins (id, username, password) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            row
        );
    }

    for (const row of enrollmentSeed) {
        await pool.query(
            'INSERT INTO enrollments (EID, USERID, CID) VALUES ($1, $2, $3) ON CONFLICT (EID) DO NOTHING',
            row
        );
    }
}

runSeed()
    .then(() => {
        console.log('Seed data inserted successfully.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Seed failed:', error.message);
        process.exit(1);
    });
